import PropTypes from 'prop-types'
import React from 'react'
import Page, {mapDispatchToProps, propTypes as pagePropTypes} from 'components/Page'
import {Modal, Alert, Button, HelpBlock, Popover, Overlay} from 'react-bootstrap'
import autobind from 'autobind-decorator'
import moment from 'moment'
import pluralize from 'pluralize'
import ContainerDimensions from 'react-container-dimensions'

import Fieldset from 'components/Fieldset'
import Breadcrumbs from 'components/Breadcrumbs'
import DailyRollupChart from 'components/DailyRollupChart'
import ReportCollection from 'components/ReportCollection'
import CalendarButton from 'components/CalendarButton'
import ButtonToggleGroup from 'components/ButtonToggleGroup'
import Form from 'components/Form'
import Messages from 'components/Messages'
import Settings from 'Settings'

import {Organization, Report} from 'models'
import utils from 'utils'

import API from 'api'

import AppContext from 'components/AppContext'
import { DEFAULT_PAGE_PROPS, CLEAR_SEARCH_PROPS } from 'actions'
import { withRouter } from 'react-router-dom'
import { connect } from 'react-redux'
import LoaderHOC, {mapDispatchToProps as loaderMapDispatchToProps} from 'HOC/LoaderHOC'

const BarChartWithLoader = connect(null, loaderMapDispatchToProps)(LoaderHOC('isLoading')('data')(DailyRollupChart))

const barColors = {
	cancelled: '#EC971F',
	verified: '#337AB7',
}

const calendarButtonCss = {
	marginLeft: '20px',
	marginTop: '-8px',
}

const legendCss = {
	width: '14px',
	height: '14px',
	display: 'inline-block',
}

class BaseRollupShow extends Page {

	static propTypes = {
		...pagePropTypes,
		date: PropTypes.object,
	}

	get dateStr() { return this.state.date.format('DD MMM YYYY') }
	get dateLongStr() { return this.state.date.format('DD MMMM YYYY') }
	get rollupStart() { return moment(this.state.date).subtract(1, 'days').startOf('day').hour(19) } //7pm yesterday
	get rollupEnd() { return moment(this.state.date).endOf('day').hour(18) } // 6:59:59pm today.

	constructor(props) {
		super(props, DEFAULT_PAGE_PROPS, CLEAR_SEARCH_PROPS)

		this.chartId = 'daily_rollup_graph'
		const qs = utils.parseQueryString(props.location.search)
		this.state = {
			date: moment(+props.date || +qs.date || undefined),
			reports: {list: []},
			reportsPageNum: 0,
			graphData: [],
			showEmailModal: false,
			email: {},
			maxReportAge: null,
			hoveredBar: {org: {}},
			orgType: Organization.TYPE.ADVISOR_ORG,
			updateChart: true,  // whether the chart needs to be updated
			isLoading: false
		}
		this.previewPlaceholderUrl = API.addAuthParams("/help")
	}

	static getDerivedStateFromProps(props, state) {
		const stateUpdate = {}
		const qs = utils.parseQueryString(props.location.search)
		const date = moment(+qs.date || undefined)
		if (!state.date.isSame(date, 'day')) {
			Object.assign(stateUpdate, {date: date})
		}
		const { appSettings } = props || {}
		const maxReportAge = appSettings.DAILY_ROLLUP_MAX_REPORT_AGE_DAYS
		if (maxReportAge !== state.maxReportAge) {
			Object.assign(stateUpdate, {maxReportAge: maxReportAge})
		}
		return stateUpdate
	}

	componentDidUpdate(prevProps, prevState) {
		if (!this.state.date.isSame(prevState.date, 'day') || prevState.maxReportAge !== this.state.maxReportAge) {
			this.loadData()
		}
	}

	fetchData(props) {
		if (!this.state.maxReportAge) {
			//don't run the query unless we've loaded the rollup settings.
			return
		}

		const rollupReportsQuery = {
			state: [Report.STATE.RELEASED], //Specifically excluding cancelled engagements.
			releasedAtStart: this.rollupStart.valueOf(),
			releasedAtEnd: this.rollupEnd.valueOf(),
			engagementDateStart: moment(this.rollupStart).subtract(this.state.maxReportAge, 'days').valueOf(),
			sortBy: "ENGAGEMENT_DATE",
			sortOrder: "DESC",
			pageNum: this.state.reportsPageNum,
			pageSize: 10,
		}
		Object.assign(rollupReportsQuery, this.getSearchQuery(props))

		let rollupGraphQuery = 'rollupGraph(startDate: $startDate, endDate: $endDate'
		let rollupGraphVariableDef = '($startDate: Long!, $endDate: Long!'
		const rollupGraphVariables = {
			startDate: rollupReportsQuery.releasedAtStart,
			endDate: rollupReportsQuery.releasedAtEnd,
		}
		if (this.state.focusedOrg) {
			if (this.state.orgType === Organization.TYPE.PRINCIPAL_ORG) {
				rollupReportsQuery.principalOrgUuid = this.state.focusedOrg.uuid
				rollupReportsQuery.includePrincipalOrgChildren = true
				rollupGraphQuery += ', principalOrganizationUuid: $principalOrganizationUuid'
				rollupGraphVariableDef += ', $principalOrganizationUuid: String!'
				rollupGraphVariables.principalOrganizationUuid = this.state.focusedOrg.uuid
			} else {
				rollupReportsQuery.advisorOrgUuid = this.state.focusedOrg.uuid
				rollupReportsQuery.includeAdvisorOrgChildren = true
				rollupGraphQuery += ' ,advisorOrganizationUuid: $advisorOrganizationUuid'
				rollupGraphVariableDef += ', $advisorOrganizationUuid: String!'
				rollupGraphVariables.advisorOrganizationUuid = this.state.focusedOrg.uuid
			}
		} else if (this.state.orgType) {
			rollupGraphQuery += ', orgType: $orgType'
			rollupGraphVariableDef += ', $orgType: OrganizationType!'
			rollupGraphVariables.orgType = this.state.orgType
		}
		rollupGraphQuery += ') {org {uuid shortName} released cancelled}'
		rollupGraphVariableDef += ')'

		let reportQuery = API.query(/* GraphQL */`
			reportList(query:$rollupReportsQuery) {
				pageNum, pageSize, totalCount, list {
					${ReportCollection.GQL_REPORT_FIELDS}
				}
			}
		`, {rollupReportsQuery}, '($rollupReportsQuery: ReportSearchQueryInput)')

		let graphQuery = API.query(/* GraphQL */
				rollupGraphQuery, rollupGraphVariables, rollupGraphVariableDef
		)

		const pinned_ORGs = Settings.pinned_ORGs

		return Promise.all([reportQuery, graphQuery]).then(values => {
			this.setState({
				reports: values[0].reportList,
				graphData: values[1].rollupGraph
					.map(d => {d.org = d.org || {uuid: "-1", shortName: "Other"}; return d})
					.sort((a, b) => {
						let a_index = pinned_ORGs.indexOf(a.org.shortName)
						let b_index = pinned_ORGs.indexOf(b.org.shortName)
						if (a_index<0) {
							let nameOrder = a.org.shortName.localeCompare(b.org.shortName)
							return (b_index<0) ?  (nameOrder === 0 ? a.org.uuid - b.org.uuid : nameOrder)  : 1
						}
						else {
							return (b_index<0) ? -1 : a_index-b_index
						}
					}),
				updateChart: true,  // update chart after fetching the data
				isLoading: false
			})
		})
	}

	render() {
		const flexStyle = {display: 'flex', flexDirection: 'column', height: '100%', flex: 1}

		return (
			<div style={flexStyle}>
				<Breadcrumbs items={[[`Rollup for ${this.dateStr}`, '/rollup']]} />
				<Messages error={this.state.error} success={this.state.success} />

				<Fieldset title={
					<span>
						Daily Rollup - {this.dateLongStr}
						<CalendarButton onChange={this.changeRollupDate} value={this.state.date.toISOString()} style={calendarButtonCss} />
					</span>
				} action={
					<div>
						<Button href={this.previewPlaceholderUrl} target="rollup" onClick={this.printPreview}>Print</Button>
						<Button onClick={this.toggleEmailModal} bsStyle="primary">Email rollup</Button>
					</div>
				} style={flexStyle}>
					<div className="mosaic-box" style={flexStyle}>
						<p className="help-text">Number of reports released today per organization</p>
						<ContainerDimensions>{({width}) => (
							<BarChartWithLoader
								width={width}
								chartId={this.chartId}
								data={this.state.graphData}
								onBarClick={this.goToOrg}
								showPopover={this.showPopover}
								hidePopover={this.hidePopover}
								updateChart={this.state.updateChart}
								isLoading={this.state.isLoading}
								barColors={barColors}
							/>
						)}</ContainerDimensions>
					</div>

					<Overlay
						show={!!this.state.graphPopover}
						placement="top"
						container={document.body}
						animation={false}
						target={() => this.state.graphPopover}
					>
						<Popover id="graph-popover" title={this.state.hoveredBar && this.state.hoveredBar.org.shortName}>
							<p>Released: {this.state.hoveredBar && this.state.hoveredBar.released}</p>
							<p>Cancelled: {this.state.hoveredBar && this.state.hoveredBar.cancelled}</p>
							<p>Click to view details</p>
						</Popover>
					</Overlay>

					<div className="graph-legend">
						<div style={{...legendCss, background: barColors.verified}}></div> Released reports:&nbsp;
						<strong>{this.state.graphData.reduce((acc, org) => acc + org.released, 0)}</strong>
					</div>
					<div className="graph-legend">
						<div style={{...legendCss, background: barColors.cancelled}}></div> Cancelled engagements:&nbsp;
						<strong>{this.state.graphData.reduce((acc, org) => acc + org.cancelled, 0)}</strong>
					</div>
				</Fieldset>

				<Fieldset
					title={`Reports ${this.state.focusedOrg ? `for ${this.state.focusedOrg.shortName}` : ''}`}
					action={!this.state.focusedOrg
						? <ButtonToggleGroup value={this.state.orgType} onChange={this.changeOrgType}>
							<Button value={Organization.TYPE.ADVISOR_ORG}>{pluralize(Settings.fields.advisor.org.name)}</Button>
							<Button value={Organization.TYPE.PRINCIPAL_ORG}>{pluralize(Settings.fields.principal.org.name)}</Button>
						</ButtonToggleGroup>
						: <Button onClick={() => this.goToOrg()}>All organizations</Button>
					}
				>
					<ReportCollection paginatedReports={this.state.reports} goToPage={this.goToReportsPage} />
				</Fieldset>

				{this.renderEmailModal()}
			</div>
		)
	}

	@autobind
	goToReportsPage(newPageNum) {
		this.setState({reportsPageNum: newPageNum}, () => this.loadData())
	}

	@autobind
	goToOrg(org) {
		this.setState({reportsPageNum: 0, focusedOrg: org, isLoading: true}, () => this.loadData())
	}

	@autobind
	changeOrgType(orgType) {
		this.setState({orgType, isLoading: true}, () => this.loadData())
	}

	@autobind
	changeRollupDate(newDate) {
		let date = moment(newDate)
		this.props.history.replace({
			pathname: 'rollup',
			search: utils.formatQueryString({date: date.valueOf()})
		})
	}

	@autobind
	showPopover(graphPopover, hoveredBar) {
		this.setState({graphPopover, hoveredBar})
	}

	@autobind
	hidePopover() {
		this.setState({graphPopover: null, hoveredBar: null})
	}

	@autobind
	renderEmailModal() {
		let email = this.state.email
		return <Modal show={this.state.showEmailModal} onHide={this.toggleEmailModal}>
			<Form formFor={email} onChange={this.onChange} submitText={false} >
				<Modal.Header closeButton>
					<Modal.Title>Email rollup - {this.dateStr}</Modal.Title>
				</Modal.Header>

				<Modal.Body>
					<h5>
						{this.state.focusedOrg ?
							`Reports for ${this.state.focusedOrg.shortName}` :
							`All reports by ${this.state.orgType.replace('_', ' ').toLowerCase()}`
						}
					</h5>

					{email.errors &&
						<Alert bsStyle="danger">{email.errors}</Alert>
					}

					<Form.Field id="to" />
					<HelpBlock>
						One or more email addresses, comma separated, e.g.:<br />
						<em>jane@nowhere.invalid, John Doe &lt;john@example.org&gt;, "Mr. X" &lt;x@example.org&gt;</em>
					</HelpBlock>
					<Form.Field componentClass="textarea" id="comment" />
				</Modal.Body>

				<Modal.Footer>
					<Button href={this.previewPlaceholderUrl} target="rollup" onClick={this.showPreview}>Preview</Button>
					<Button bsStyle="primary" onClick={this.emailRollup}>Send email</Button>
				</Modal.Footer>
			</Form>
		</Modal>
	}

	@autobind
	toggleEmailModal() {
		this.setState({showEmailModal: !this.state.showEmailModal})
	}

	@autobind
	printPreview() {
		this.showPreview(true)
	}

	@autobind
	showPreview(print) {
		let graphQL = /* GraphQL */`
			showRollupEmail(
				startDate: ${this.rollupStart.valueOf()},
				endDate: ${this.rollupEnd.valueOf()}
		`
		if (this.state.focusedOrg) {
			if (this.state.orgType === Organization.TYPE.PRINCIPAL_ORG) {
				graphQL += `, principalOrganizationUuid: ${this.state.focusedOrg.uuid}`
			} else {
				graphQL += `, advisorOrganizationUuid: ${this.state.focusedOrg.uuid}`
			}
		}
		if (this.state.orgType) {
			graphQL += `, orgType: ${this.state.orgType}`
		}
		graphQL += `)`
		API.query(graphQL).then(data => {
			let rollupWindow = window.open("", "rollup")
			let doc = rollupWindow.document
			doc.clear()
			doc.open()
			doc.write(data.showRollupEmail)
			doc.close()
			if (print === true) {
				rollupWindow.print()
			}
		})
	}

	@autobind
	emailRollup() {
		let email = this.state.email
		let r = utils.parseEmailAddresses(email.to)
		if (!r.isValid) {
			email.errors = r.message
			this.setState({email})
			return
		}
		const emailDelivery = {
			toAddresses: r.to,
			comment: email.comment
		}
		let graphql = 'emailRollup(startDate: $startDate, endDate: $endDate'
		const variables = {
				startDate: this.rollupStart.valueOf(),
				endDate: this.rollupEnd.valueOf()
		}
		let variableDef = '($startDate: Long!, $endDate: Long!'
		if (this.state.focusedOrg) {
			if (this.state.orgType === Organization.TYPE.PRINCIPAL_ORG) {
				graphql += ', principalOrganizationUuid: $principalOrganizationUuid'
				variables.principalOrganizationUuid = this.state.focusedOrg.uuid
				variableDef += ', $principalOrganizationUuid: String!'
			} else {
				graphql += ',advisorOrganizationUuid: $advisorOrganizationUuid'
				variables.advisorOrganizationUuid = this.state.focusedOrg.uuid
				variableDef += ', $advisorOrganizationUuid: String!'
			}
		}
		if (this.state.orgType) {
			graphql += ', orgType: $orgType'
			variables.orgType = this.state.orgType
			variableDef += ', $orgType: OrganizationType!'
		}
		graphql += ', email: $email)'
		variables.email = emailDelivery
		variableDef += ', $email: AnetEmailInput!)'

		API.mutation(graphql, variables, variableDef)
			.then(data => {
				this.setState({
					success: 'Email successfully sent',
					error:null,
					showEmailModal: false,
					email: {}
				})
			}).catch(error => {
				this.setState({
					showEmailModal: false,
					email: {}
				})
				this.handleError(error)
			})
	}
}

const mapStateToProps = (state, ownProps) => ({
	searchQuery: state.searchQuery
})

const RollupShow = (props) => (
	<AppContext.Consumer>
		{context =>
			<BaseRollupShow appSettings={context.appSettings} {...props} />
		}
	</AppContext.Consumer>
)

export default connect(mapStateToProps, mapDispatchToProps)(withRouter(RollupShow))
