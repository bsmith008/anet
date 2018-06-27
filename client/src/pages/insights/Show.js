import React from 'react'
import PropTypes from 'prop-types'
import Page, {mapDispatchToProps, propTypes as pagePropTypes} from 'components/Page'
import PendingApprovalReports from 'components/PendingApprovalReports'
import CancelledEngagementReports from 'components/CancelledEngagementReports'
import ReportsByTask from 'components/ReportsByTask'
import ReportsByDayOfWeek from 'components/ReportsByDayOfWeek'
import FutureEngagementsByLocation from 'components/FutureEngagementsByLocation'
import Breadcrumbs from 'components/Breadcrumbs'
import Messages from 'components/Messages'
import Fieldset from 'components/Fieldset'
import CalendarButton from 'components/CalendarButton'
import autobind from 'autobind-decorator'
import moment from 'moment'

import FilterableAdvisorReportsTable from 'components/AdvisorReports/FilterableAdvisorReportsTable'
import DateRangeSearch from 'components/advancedSearch/DateRangeSearch'

import {Report} from 'models'
import { DEFAULT_PAGE_PROPS, DEFAULT_SEARCH_PROPS, SEARCH_OBJECT_TYPES } from 'actions'
import AppContext from 'components/AppContext'
import { connect } from 'react-redux'
import _isEqualWith from 'lodash/isEqualWith'
import utils from 'utils'

export const NOT_APPROVED_REPORTS = 'not-approved-reports'
export const CANCELLED_REPORTS = 'cancelled-reports'
export const REPORTS_BY_TASK = 'reports-by-task'
export const REPORTS_BY_DAY_OF_WEEK = 'reports-by-day-of-week'
export const FUTURE_ENGAGEMENTS_BY_LOCATION = 'future-engagements-by-location'
export const ADVISOR_REPORTS = 'advisor-reports'

export const INSIGHTS = [
  NOT_APPROVED_REPORTS, CANCELLED_REPORTS, REPORTS_BY_TASK,
  FUTURE_ENGAGEMENTS_BY_LOCATION, REPORTS_BY_DAY_OF_WEEK, ADVISOR_REPORTS
]

export const INSIGHT_DETAILS = {
  [NOT_APPROVED_REPORTS]: {
    component: PendingApprovalReports,
    title: 'Pending Approval Reports',
    dateRange: false,
    showCalendar: true
  },
  [CANCELLED_REPORTS]: {
    component: CancelledEngagementReports,
    title: 'Cancelled Engagement Reports',
    dateRange: false,
    showCalendar: true
  },
  [REPORTS_BY_TASK]: {
    component: ReportsByTask,
    title: 'Reports by Task',
    help: '',
    dateRange: false,
    showCalendar: true
  },
  [REPORTS_BY_DAY_OF_WEEK]: {
    component: ReportsByDayOfWeek,
    title: 'Reports by day of the week',
    help: 'Number of reports by day of the week',
    dateRange: true,
    showCalendar: false
  },
  [FUTURE_ENGAGEMENTS_BY_LOCATION]: {
    component: FutureEngagementsByLocation,
    title: 'Future Engagements by Location',
    help: 'Number of future engagements by location',
    dateRange: true,
    onlyShowBetween: true,
  },
  [ADVISOR_REPORTS]: {
    component: FilterableAdvisorReportsTable,
    title: 'Advisor Reports',
    dateRange: false,
    showCalendar: false
  },
}

const PREFIX_FUTURE = 'future'

const calendarButtonCss = {
  marginLeft: '20px',
  marginTop: '-8px',
}

const dateRangeFilterCss = {
  marginTop: '20px'
}

class BaseInsightsShow extends Page {

  static propTypes = {
    ...pagePropTypes,
    appSettings: PropTypes.object,
  }

  get currentDateTime() {
    return moment().clone()
  }

  get cutoffDate() {
    const { appSettings } = this.props || {}
    let maxReportAge = 1 + (parseInt(appSettings.DAILY_ROLLUP_MAX_REPORT_AGE_DAYS, 10) || 14)
    return moment().subtract(maxReportAge, 'days').clone()
  }

  get referenceDateLongStr() { return this.state.referenceDate.format('DD MMMM YYYY') }

  constructor(props) {
    super(props, Object.assign({}, DEFAULT_PAGE_PROPS), Object.assign({}, DEFAULT_SEARCH_PROPS, {onSearchGoToSearchPage: false}))

    this.state = {
      referenceDate: moment().clone(),
      startDate: moment().clone(),
      endDate: moment().clone(),
    }
  }

  get defaultDates() {
    return {
      relative: "0",
      start: this.state.startDate.toISOString(),
      end: this.state.endDate.toISOString()
    }
  }

  get insightQueryParams() {
    return {
      [NOT_APPROVED_REPORTS]: [
        {key: 'State', value: {state: Report.STATE.PENDING_APPROVAL, toQuery: () => {return {state: Report.STATE.PENDING_APPROVAL}}}},
        {key: 'updatedAtEnd', value: this.state.referenceDate.clone().valueOf()},
      ],
      [CANCELLED_REPORTS]: [
        {key: 'State', value: {state: Report.STATE.CANCELLED, cancelledReason: '', toQuery: () => {return {state: Report.STATE.CANCELLED}}}},
        {key: 'releasedAtStart', value: this.state.referenceDate.clone().valueOf()},
      ],
      [REPORTS_BY_TASK]: [
        {key: 'State', value: {state: Report.STATE.RELEASED, toQuery: () => {return {state: Report.STATE.RELEASED}}}},
        {key: 'releasedAtStart', value: this.state.referenceDate.clone().valueOf()},
      ],
      [REPORTS_BY_DAY_OF_WEEK]: [
        {key: 'State', value: {state: Report.STATE.RELEASED, toQuery: () => {return {state: Report.STATE.RELEASED}}}},
        {key: 'releasedAtStart', value: this.state.startDate.clone().valueOf()},
        {key: 'releasedAtEnd', value: this.state.endDate.clone().valueOf()},
        {key: 'includeEngagementDayOfWeek', value: 1},
      ],
      [FUTURE_ENGAGEMENTS_BY_LOCATION]: [
        {key: 'engagementDateStart', value: this.state.startDate.clone().startOf('day').valueOf()},
        {key: 'engagementDateEnd', value: this.state.endDate.clone().valueOf()},
      ],
      [ADVISOR_REPORTS]: [],
    }
  }

  getFilters = () => {
    const insight = INSIGHT_DETAILS[this.props.match.params.insight]
    const calenderFilter = (insight.showCalendar) ? <CalendarButton onChange={this.changeReferenceDate} value={this.state.referenceDate.toISOString()} style={calendarButtonCss} /> : null
    const dateRangeFilter = (insight.dateRange) ? <DateRangeSearch queryKey="engagementDate" value={this.defaultDates} onChange={this.handleChangeDateRange} style={dateRangeFilterCss} onlyBetween={insight.onlyShowBetween} /> : null
    return <span>{dateRangeFilter}{calenderFilter}</span>
  }

  @autobind
  updateSearchQuery() {
    this.props.setSearchQuery({
      text: '',
      objectType: SEARCH_OBJECT_TYPES.REPORTS,
      filters: this.insightQueryParams[this.props.match.params.insight]
    })
  }

  componentDidUpdate(prevProps, prevState) {
    if (prevProps.match.params.insight !== this.props.match.params.insight) {
      const oldQueryParams = this.insightQueryParams[prevProps.match.params.insight]
      const newQueryParams = this.insightQueryParams[this.props.match.params.insight]
      this.setStateDefaultDates(
        this.props.match.params.insight,
        !_isEqualWith(oldQueryParams, newQueryParams, utils.equalFunction) ? this.updateSearchQuery : '')
    }
  }

  componentDidMount() {
    super.componentDidMount()
    this.setStateDefaultDates(this.props.match.params.insight, this.updateSearchQuery)
    this.props.setSearchProps({
      searchObjectTypes: [SEARCH_OBJECT_TYPES.REPORTS],
    })
  }

  setStateDefaultDates = (insight, cb) => {
    const prefix = insight.split('-', 1).pop()
    if (prefix !== undefined && prefix === PREFIX_FUTURE) {
      this.setStateDefaultFutureDates(cb)
    } else {
      this.setStateDefaultPastDates(cb)
    }
  }

  setStateDefaultPastDates = (cb) => {
    this.setState({
      referenceDate: this.cutoffDate,
      startDate: this.cutoffDate,
      endDate: this.currentDateTime.endOf('day')
    }, () => {(typeof cb === 'function') && cb()})
  }

  setStateDefaultFutureDates = (cb) => {
    this.setState({
      referenceDate: this.currentDateTime,
      startDate: this.currentDateTime,
      endDate: this.currentDateTime.add(14, 'days').endOf('day')
    }, () => {(typeof cb === 'function') && cb()})
  }

  handleChangeDateRange = (value) => {
    if (value.relative < 0) {
      this.updateRelativeDateTime(value)
    } else {
      this.updateDateRange(value)
    }
  }

  updateRelativeDateTime = (value) => {
    const startDate = moment(parseInt(value.relative, 10) + this.currentDateTime.valueOf())
    this.setState({
      startDate: startDate,
      endDate: this.currentDateTime
    })
  }

  updateDateRange = (value) => {
    if (value.start !== null) {
      this.updateDate("startDate", moment(value.start))
    }

    if (value.end !== null) {
      this.updateDate("endDate", moment(value.end).endOf('day'))
    }
  }

  updateDate = (key, newDate) => {
    const oldDate = this.state[key]
    const dateChaged = newDate.valueOf() !== oldDate.valueOf()
    if (dateChaged) {
      this.setState( { [key]: newDate } )
    }
  }

  @autobind
  changeReferenceDate(newDate) {
    let date = moment(newDate)
    if (date.valueOf() !== this.state.referenceDate.valueOf()) {
      this.setState({referenceDate: date})
    }
  }

  render() {
    const insightConfig = INSIGHT_DETAILS[this.props.match.params.insight]
    const InsightComponent = insightConfig.component
    const insightPath = '/insights/' + this.props.match.params.insight
    const queryParams = this.getSearchQuery()

    return (
      <div>
        <Breadcrumbs items={[['Insights ' + insightConfig.title, insightPath]]} />
        <Messages error={this.state.error} success={this.state.success} />

        {this.state.referenceDate &&
          <Fieldset id={this.props.match.params.insight} data-jumptarget title={
            <span>
              {insightConfig.title}
              {this.getFilters()}
            </span>
            }>
            <InsightComponent
              queryParams={queryParams}
              date={this.state.referenceDate.clone()}
              startDate={this.state.startDate.clone()}
              endDate={this.state.endDate.clone()}
            />
          </Fieldset>
        }
      </div>
    )
  }

}

const mapStateToProps = (state, ownProps) => ({
	searchQuery: state.searchQuery
})

const InsightsShow = (props) => (
	<AppContext.Consumer>
		{context =>
			<BaseInsightsShow appSettings={context.appSettings} {...props} />
		}
	</AppContext.Consumer>
)

export default connect(mapStateToProps, mapDispatchToProps)(InsightsShow)
