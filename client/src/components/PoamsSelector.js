import React, {Component, PropTypes} from 'react'
import autobind from 'autobind-decorator'

import Fieldset from 'components/Fieldset'
import Autocomplete from 'components/Autocomplete'
import Form from 'components/Form'
import {Table, Button, HelpBlock} from 'react-bootstrap'

import {Poam} from 'models'

import REMOVE_ICON from 'resources/delete.png'
import WARNING_ICON from 'resources/warning.png'

export default class PoamsSelector extends Component {
	static propTypes = {
		poams: PropTypes.array.isRequired,
		onChange: PropTypes.func.isRequired,
		onErrorChange: PropTypes.func,
		validationState: PropTypes.string,
		shortcuts: PropTypes.array,
		optional: PropTypes.bool,
	}

	render() {
		let {poams, shortcuts, validationState, optional} = this.props

		return <Fieldset title="Plans of Action and Milestones / Pillars" action={optional && "(Optional)"} className="poams-selector">
			<Form.Field id="poams" label="PoAMs" validationState={validationState} >
				<Autocomplete
					objectType={Poam}
					fields={'id, shortName, longName'}
					queryParams={{status: 'ACTIVE'}}
					placeholder="Start typing to search for PoAMs..."
					template={poam =>
						<span>{[poam.shortName, poam.longName].join(' - ')}</span>
					}
					onChange={this.addPoam}
					onErrorChange={this.props.onErrorChange}
					clearOnSelect={true} />

				{validationState && <HelpBlock>
					<img src={WARNING_ICON} role="presentation" height="20px" />
					PoAM not found in Database
				</HelpBlock>}

				<Table hover striped>
					<thead>
						<tr>
							<th>Name</th>
							<th></th>
						</tr>
					</thead>
					<tbody>
						{poams.map((poam, idx) =>
							<tr key={poam.id}>
								<td>{poam.shortName} - {poam.longName}</td>
								<td onClick={this.removePoam.bind(this, poam)} id={'poamDelete_' + idx}>
									<span style={{cursor: 'pointer'}}><img src={REMOVE_ICON} height={14} alt="Remove attendee" /></span>
								</td>
							</tr>
						)}
					</tbody>
				</Table>

				{poams.length === 0 && <p style={{textAlign: 'center'}}><em>
					No PoAMs selected
					{this.props.optional && ' (this is fine if no PoAMs were discussed)'}
					.
				</em></p>}

				{ shortcuts && shortcuts.length > 0 && this.renderShortcuts() }
			</Form.Field>
		</Fieldset>
	}

	renderShortcuts() {
		let shortcuts = this.props.shortcuts || []
		return <Form.Field.ExtraCol className="shortcut-list">
			<h5>Recent PoAMs</h5>
			{shortcuts.map(poam =>
				<Button key={poam.id} bsStyle="link" onClick={this.addPoam.bind(this, poam)}>Add "{poam.shortName} {poam.longName.substr(0,80)}{poam.longName.length > 80 ? '...' : ''}"</Button>
			)}
		</Form.Field.ExtraCol>
	}

	@autobind
	addPoam(newPoam) {
		if (!newPoam || !newPoam.id) {
			return
		}

		let poams = this.props.poams

		if (!poams.find(poam => poam.id === newPoam.id)) {
			poams.push(newPoam)
		}

		this.props.onChange()
	}

	@autobind
	removePoam(oldPoam) {
		let poams = this.props.poams
		let index = poams.findIndex(poam => poam.id === oldPoam.id)

		if (index !== -1) {
			poams.splice(index, 1)
			this.props.onChange()
		}
	}
}
