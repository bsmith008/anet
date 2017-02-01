package mil.dds.anet.resources;

import java.util.HashMap;
import java.util.List;
import java.util.Optional;
import java.util.stream.Collectors;

import javax.annotation.security.PermitAll;
import javax.servlet.http.HttpServletRequest;
import javax.ws.rs.DELETE;
import javax.ws.rs.DefaultValue;
import javax.ws.rs.GET;
import javax.ws.rs.POST;
import javax.ws.rs.Path;
import javax.ws.rs.PathParam;
import javax.ws.rs.Produces;
import javax.ws.rs.QueryParam;
import javax.ws.rs.WebApplicationException;
import javax.ws.rs.core.Context;
import javax.ws.rs.core.MediaType;
import javax.ws.rs.core.Response;
import javax.ws.rs.core.Response.Status;

import org.eclipse.jetty.util.log.Log;
import org.eclipse.jetty.util.log.Logger;
import org.joda.time.DateTime;

import com.codahale.metrics.annotation.Timed;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.google.common.collect.ImmutableList;
import com.google.common.collect.ImmutableMap;

import io.dropwizard.auth.Auth;
import mil.dds.anet.AnetEmailWorker;
import mil.dds.anet.AnetEmailWorker.AnetEmail;
import mil.dds.anet.AnetObjectEngine;
import mil.dds.anet.beans.ApprovalAction;
import mil.dds.anet.beans.ApprovalAction.ApprovalType;
import mil.dds.anet.beans.ApprovalStep;
import mil.dds.anet.beans.Comment;
import mil.dds.anet.beans.Organization;
import mil.dds.anet.beans.Person;
import mil.dds.anet.beans.Person.Role;
import mil.dds.anet.beans.Poam;
import mil.dds.anet.beans.Position;
import mil.dds.anet.beans.Report;
import mil.dds.anet.beans.Report.ReportState;
import mil.dds.anet.beans.ReportPerson;
import mil.dds.anet.beans.search.ReportSearchQuery;
import mil.dds.anet.database.AdminDao.AdminSettingKeys;
import mil.dds.anet.database.ReportDao;
import mil.dds.anet.graphql.GraphQLFetcher;
import mil.dds.anet.graphql.GraphQLParam;
import mil.dds.anet.graphql.IGraphQLResource;
import mil.dds.anet.utils.ResponseUtils;
import mil.dds.anet.utils.Utils;

@Path("/api/reports")
@Produces(MediaType.APPLICATION_JSON)
@PermitAll
public class ReportResource implements IGraphQLResource {

	ReportDao dao;
	AnetObjectEngine engine;
	ObjectMapper mapper;

	private static Logger log = Log.getLogger(ReportResource.class);

	public ReportResource(AnetObjectEngine engine) {
		this.engine = engine;
		this.dao = engine.getReportDao();
		this.mapper = new ObjectMapper();
	}

	@Override
	public String getDescription() { return "Reports"; }

	@Override
	public Class<Report> getBeanClass() { return Report.class; }

	@GET
	@Timed
	@GraphQLFetcher
	@Path("/")
	public List<Report> getAll(@Auth Person p, @DefaultValue("0") @QueryParam("pageNum") Integer pageNum, @DefaultValue("100") @QueryParam("pageSize") Integer pageSize) {
		return dao.getAll(pageNum, pageSize);
	}

	@GET
	@Timed
	@Path("/{id}")
	@GraphQLFetcher
	public Report getById(@PathParam("id") Integer id) {
		return dao.getById(id);
	}

	@POST
	@Timed
	@Path("/new")
	public Report createNewReport(@Auth Person author, Report r) {
		if (r.getState() == null) { r.setState(ReportState.DRAFT); }
		if (r.getAuthor() == null) { r.setAuthor(author); }
	
		Person primaryAdvisor = findPrimaryAttendee(r, Role.ADVISOR);
		if (r.getAdvisorOrg() == null && primaryAdvisor != null) {
			r.setAdvisorOrg(engine.getOrganizationForPerson(primaryAdvisor));
		}
		Person primaryPrincipal = findPrimaryAttendee(r, Role.PRINCIPAL);
		if (r.getPrincipalOrg() == null && primaryPrincipal != null) {
			r.setPrincipalOrg(engine.getOrganizationForPerson(primaryPrincipal));
		}
		
		return dao.insert(r);
	}

	private Person findPrimaryAttendee(Report r, Role role) { 
		if (r.getAttendees() == null) { return null; } 
		return r.getAttendees().stream().filter(p ->
				p.isPrimary() && p.getRole().equals(role)
			).findFirst().orElse(null);
	}
	
	@POST
	@Timed
	@Path("/update")
	public Response editReport(@Auth Person editor, Report r) {
		//Verify this person has access to edit this report
		//Either they are the author, or an approver for the current step.
		Report existing = dao.getById(r.getId());
		r.setState(existing.getState());
		r.setApprovalStep(existing.getApprovalStep());
		r.setAuthor(existing.getAuthor());
		assertCanEditReport(r, editor);
		
		//If there is a change to the primary advisor, change the advisor Org. 
		Person primaryAdvisor = findPrimaryAttendee(r, Role.ADVISOR);
		if (Utils.idEqual(primaryAdvisor, existing.loadPrimaryAdvisor()) == false || existing.getAdvisorOrg() == null) { 
			r.setAdvisorOrg(engine.getOrganizationForPerson(primaryAdvisor));
		} else { 
			r.setAdvisorOrg(existing.getAdvisorOrg());
		}

		Person primaryPrincipal = findPrimaryAttendee(r, Role.PRINCIPAL);
		if (Utils.idEqual(primaryPrincipal, existing.loadPrimaryPrincipal()) ==  false || existing.getPrincipalOrg() == null) { 
			r.setPrincipalOrg(engine.getOrganizationForPerson(primaryPrincipal));
		} else { 
			r.setPrincipalOrg(existing.getPrincipalOrg());
		}
		
		dao.update(r);
		//Update Attendees: Fetch the people associated with this report
		List<ReportPerson> existingPeople = dao.getAttendeesForReport(r.getId());
		//Find any differences and fix them.
		for (ReportPerson rp : r.getAttendees()) {
			Optional<ReportPerson> existingPerson = existingPeople.stream().filter(el -> el.getId().equals(rp.getId())).findFirst();
			if (existingPerson.isPresent()) { 
				if (existingPerson.get().isPrimary() != rp.isPrimary()) { 
					dao.updateAttendeeOnReport(rp, r);
				}
				existingPeople.remove(existingPerson.get());
			} else { 
				dao.addAttendeeToReport(rp, r);
			}
		}
		//Any attendees left in existingPeople needs to be removed.
		for (ReportPerson rp : existingPeople) {
			dao.removeAttendeeFromReport(rp, r);
		}

		//Update Poams:
		List<Poam> existingPoams = dao.getPoamsForReport(r);
		List<Integer> existingPoamIds = existingPoams.stream().map( p -> p.getId()).collect(Collectors.toList());
		for (Poam p : r.getPoams()) {
			int idx = existingPoamIds.indexOf(p.getId());
			if (idx == -1) { dao.addPoamToReport(p, r); } else {  existingPoamIds.remove(idx); }
		}
		for (Integer id : existingPoamIds) {
			dao.removePoamFromReport(Poam.createWithId(id), r);
		}
		return Response.ok().build();
	}

	private void assertCanEditReport(Report report, Person editor) {
		String permError = "You do not have permission to edit this report. ";
		switch (report.getState()) {
		case DRAFT:
		case REJECTED:
			//Must be the author
			if (!report.getAuthor().getId().equals(editor.getId())) {
				throw new WebApplicationException(permError + "Must be the author of this report.", Status.FORBIDDEN);
			}
			break;
		case PENDING_APPROVAL:
			//Either the author, or the approver
			if (report.getAuthor().getId().equals(editor.getId())) {
				//This is okay, but move it back to draft
				report.setState(ReportState.DRAFT);
				report.setApprovalStep(null);
			} else {
				boolean canApprove = engine.canUserApproveStep(editor.getId(), report.getApprovalStep().getId());
				if (!canApprove) {
					throw new WebApplicationException(permError + "Must be the author or the current approver", Status.FORBIDDEN);
				}
			}
			break;
		case RELEASED:
			throw new WebApplicationException(permError + "Cannot edit a released report", Status.FORBIDDEN);
		}
	}
	
	/* Submit a report for approval
	 * Kicks a report from DRAFT to PENDING_APPROVAL and sets the approval step Id
	 */
	@POST
	@Timed
	@Path("/{id}/submit")
	public Report submitReport(@PathParam("id") int id) {
		Report r = dao.getById(id);
		//TODO: this needs to be done by either the Author, a Superuser for the AO, or an Administrator

		if (r.getAdvisorOrg() == null) {
			ReportPerson advisor = r.loadPrimaryAdvisor();
			if (advisor == null) {
				throw new WebApplicationException("Report missing primary advisor", Status.BAD_REQUEST);
			}
			r.setAdvisorOrg(engine.getOrganizationForPerson(advisor));
		}
		if (r.getPrincipalOrg() == null) {
			ReportPerson principal = r.loadPrimaryPrincipal();
			if (principal == null) {
				throw new WebApplicationException("Report missing primary principal", Status.BAD_REQUEST);
			}
			r.setPrincipalOrg(engine.getOrganizationForPerson(principal));
		}

		if (r.getEngagementDate() == null) {
			throw new WebApplicationException("Missing engagement date", Status.BAD_REQUEST);
		}

		Organization org = engine.getOrganizationForPerson(r.getAuthor());
		if (org == null ) {
			// Author missing Org, use the Default Approval Workflow
			org = Organization.createWithId(
				Integer.parseInt(engine.getAdminSetting(AdminSettingKeys.DEFAULT_APPROVAL_ORGANIZATION)));
		}
		List<ApprovalStep> steps = engine.getApprovalStepsForOrg(org);
		if (steps == null || steps.size() == 0) {
			//Missing approval steps for this organization
			steps = engine.getApprovalStepsForOrg(
					Organization.createWithId(Integer.parseInt(engine.getAdminSetting(AdminSettingKeys.DEFAULT_APPROVAL_ORGANIZATION))));
		}

		//Push the report into the first step of this workflow
		r.setApprovalStep(steps.get(0));
		r.setState(ReportState.PENDING_APPROVAL);
		int numRows = dao.update(r);
		sendApprovalNeededEmail(r);
		log.info("Putting report {} into step {} because of org {} on author {}",
				r.getId(), steps.get(0).getId(), org.getId(), r.getAuthor().getId());

		if (numRows != 1) {
			throw new WebApplicationException("No records updated", Status.BAD_REQUEST);
		}

		return r;
	}

	private void sendApprovalNeededEmail(Report r) {
		ApprovalStep step = r.loadApprovalStep();
		List<Position> approvers = step.loadApprovers();
		AnetEmail approverEmail = new AnetEmail();
		approverEmail.setTemplateName("/emails/approvalNeeded.ftl");
		approverEmail.setSubject("ANET Report needs your approval");
		approverEmail.setToAddresses(approvers.stream()
				.filter(a -> a.getPerson() != null)
				.map(a -> a.loadPerson().getEmailAddress())
				.collect(Collectors.toList()));
		approverEmail.setContext(ImmutableMap.of("report", r, "approvalStepName", step.getName()));
		AnetEmailWorker.sendEmailAsync(approverEmail);
	}

	/*
	 * Approve this report for the current step.
	 * TODO: this should run common approval code that checks if any previous approving users can approve the future steps
	 */
	@POST
	@Timed
	@Path("/{id}/approve")
	public Report approveReport(@Auth Person approver, @PathParam("id") int id, Comment comment) {
		Report r = dao.getById(id);
		if (r == null) {
			throw new WebApplicationException("Report not found", Status.NOT_FOUND);
		}
		if (r.getApprovalStep() == null) {
			log.info("Report ID {} does not currently need an approval", r.getId());
			throw new WebApplicationException("No approval step found", Status.NOT_FOUND);
		}
		ApprovalStep step = r.loadApprovalStep();

		//Verify that this user can approve for this step.

		boolean canApprove = engine.canUserApproveStep(approver.getId(), step.getId());
		if (canApprove == false) {
			log.info("User ID {} cannot approve report ID {} for step ID {}",approver.getId(), r.getId(), step.getId());
			throw new WebApplicationException("User cannot approve report", Status.FORBIDDEN);
		}

		//Write the approval
		//TODO: this should be in a transaction....
		ApprovalAction approval = new ApprovalAction();
		approval.setReport(r);
		approval.setStep(ApprovalStep.createWithId(step.getId()));
		approval.setPerson(approver);
		approval.setType(ApprovalType.APPROVE);
		engine.getApprovalActionDao().insert(approval);

		//Update the report
		r.setApprovalStep(ApprovalStep.createWithId(step.getNextStepId()));
		if (step.getNextStepId() == null) {
			r.setState(ReportState.RELEASED);
		} else {
			sendApprovalNeededEmail(r);
		}
		dao.update(r);
		
		//Add the comment
		if (comment != null && comment.getText() != null && comment.getText().trim().length() > 0)  {
			comment.setReportId(r.getId());
			comment.setAuthor(approver);
			engine.getCommentDao().insert(comment);
		}
		//TODO: close the transaction.

		return r;
	}

	/**
	 * Rejects a report and moves it back to the author with state REJECTED. 
	 * @param id the Report ID to reject
	 * @param reason : A @link Comment object which will be posted to the report with the reason why the report was rejected.
	 * @return 200 on a successful reject, 401 if you don't have privileges to reject this report.
	 */
	@POST
	@Timed
	@Path("/{id}/reject")
	public Report rejectReport(@Auth Person approver, @PathParam("id") int id, Comment reason) {
		Report r = dao.getById(id);
		ApprovalStep step = r.loadApprovalStep();

		//Verify that this user can reject for this step.
		boolean canApprove = engine.canUserApproveStep(approver.getId(), step.getId());
		if (canApprove == false) {
			log.info("User ID {} cannot reject report ID {} for step ID {}",approver.getId(), r.getId(), step.getId());
			throw new WebApplicationException("User cannot approve report", Status.FORBIDDEN);
		}

		//Write the rejection
		//TODO: This should be in a transaction
		ApprovalAction approval = new ApprovalAction();
		approval.setReport(r);
		approval.setStep(ApprovalStep.createWithId(step.getId()));
		approval.setPerson(approver);
		approval.setType(ApprovalType.REJECT);
		engine.getApprovalActionDao().insert(approval);

		//Update the report
		r.setApprovalStep(null);
		r.setState(ReportState.REJECTED);
		dao.update(r);

		//Add the comment
		reason.setReportId(r.getId());
		reason.setAuthor(approver);
		engine.getCommentDao().insert(reason);

		//TODO: close the transaction.
		
		sendReportRejectEmail(r, approver, reason);
		return r;
	}

	private void sendReportRejectEmail(Report r, Person rejector, Comment rejectionComment) {
		AnetEmail email = new AnetEmail();
		email.setTemplateName("/emails/reportRejection.ftl");
		email.setSubject("ANET Report Rejected");
		email.setToAddresses(ImmutableList.of(r.loadAuthor().getEmailAddress()));
		email.setContext(ImmutableMap.of("report", r, "rejector", rejector, "comment", rejectionComment));
		AnetEmailWorker.sendEmailAsync(email);
	}
	
	
	@POST
	@Timed
	@Path("/{id}/comments")
	public Comment postNewComment(@Auth Person author, @PathParam("id") int reportId, Comment comment) {
		comment.setReportId(reportId);
		comment.setAuthor(author);
		comment = engine.getCommentDao().insert(comment);
		sendNewCommentEmail(dao.getById(reportId), comment);
		return comment;
	}

	private void sendNewCommentEmail(Report r, Comment comment) {
		AnetEmail email = new AnetEmail();
		email.setTemplateName("/emails/newReportComment.ftl");
		email.setSubject("New Comment on your ANET Report");
		email.setToAddresses(ImmutableList.of(r.loadAuthor().getEmailAddress()));
		email.setContext(ImmutableMap.of("report", r, "comment", comment));
		AnetEmailWorker.sendEmailAsync(email);
	}
	
	@GET
	@Timed
	@Path("/{id}/comments")
	public List<Comment> getCommentsForReport(@PathParam("id") int reportId) {
		return engine.getCommentDao().getCommentsForReport(Report.createWithId(reportId));
	}

	@DELETE
	@Timed
	@Path("/{id}/comments/{commentId}")
	public Response deleteComment(@PathParam("commentId") int commentId) {
		//TODO: user validation on /who/ is allowed to delete a comment.
		int numRows = engine.getCommentDao().delete(commentId);
		return (numRows == 1) ? Response.ok().build() : ResponseUtils.withMsg("Unable to delete comment", Status.NOT_FOUND);
	}

	@POST
	@Timed
	@Path("/{id}/email")
	public Response emailReport(@Auth Person user, @PathParam("id") int reportId, AnetEmail email) { 
		Report r = dao.getById(reportId);
		if (r == null) { return Response.status(Status.NOT_FOUND).build(); }
		
		if (email.getContext() == null) { email.setContext(new HashMap<String,Object>()); }
		
		email.setTemplateName("/emails/emailReport.ftl");
		email.setSubject("Sharing a report in ANET");
		email.getContext().put("report", r);
		email.getContext().put("sender", user);
		AnetEmailWorker.sendEmailAsync(email);
		return Response.ok().build();
	}
	
	@GET
	@Timed
	@GraphQLFetcher("pendingMyApproval")
	@Path("/pendingMyApproval")
	public List<Report> getReportsPendingMyApproval(@Auth Person approver) {
		return dao.getReportsForMyApproval(approver);
	}

	@GET
	@Timed
	@Path("/search")
	public List<Report> search(@Context HttpServletRequest request) {
		try {
			return search(ResponseUtils.convertParamsToBean(request, ReportSearchQuery.class));
		} catch (IllegalArgumentException e) {
			throw new WebApplicationException(e.getMessage(), e.getCause(), Status.BAD_REQUEST);
		}
	}

	@POST
	@Timed
	@GraphQLFetcher
	@Path("/search")
	public List<Report> search(@GraphQLParam("query") ReportSearchQuery query) {
		return dao.search(query);
	}
	
	@GraphQLFetcher("myOrgToday")
	public List<Report> myOrgReportsToday(@Auth Person user) { 
		Position pos = user.loadPosition();
		if (pos == null) { return ImmutableList.of(); } 
		Organization org = pos.loadOrganization();
		if (org == null) { return ImmutableList.of(); } 
		
		ReportSearchQuery query = new ReportSearchQuery();
		query.setAuthorOrgId(org.getId());
		query.setCreatedAtStart(DateTime.now().minusDays(1));
		
		return dao.search(query);
	}
	
	@GraphQLFetcher("myReportsToday")
	public List<Report> myReportsToday(@Auth Person user) { 
		ReportSearchQuery query = new ReportSearchQuery();
		query.setAuthorId(user.getId());
		query.setCreatedAtStart(DateTime.now().minusDays(1));
		
		return dao.search(query);
	}

	@GET
	@Timed
	@GraphQLFetcher
	@Path("/releasedToday")
	public List<Report> releasedToday() {
		return dao.getRecentReleased();
	}
}
