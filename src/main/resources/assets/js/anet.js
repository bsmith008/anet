Date.prototype.toInputFormat = function() {
	return [this.getFullYear(), this.getMonth() + 1, this.getDate()]
		.map(function(value) {
			return value < 10 ? "0" + value : value;
		})
		.join('-');
};

function initializeDates(container) {
	if (!container) container = document;
	$(container).find('[data-date]').each(function() {
		var date = new Date(this.getAttribute('data-date'));
		this.value = date.toInputFormat();
	});

	$('[data-datepicker]').datepicker({
		todayBtn: "linked",
		todayHighlight: true,
		daysOfWeekHighlighted: "5,6"
	});
}

function jsonForm(formName) {
	return JSON.stringify(buildForm(formName));
}

function buildForm(formName) {
	var $form = $("#" + formName);
	var output = {};

	$form.serializeArray().forEach(function(input) {
		if (input.name.toLowerCase().indexOf('date') !== -1 && input.value) {
			input.value = new Date(input.value).toISOString();
		}

		output[input.name] = input.value;
	});

	return output;
}

function enableLocationSearch(selectId) {
	$(selectId).select2({
		dropdownParent: $(".mainbody"),
		ajax: {
			url: "/locations/search",
			dataType: 'json',
			delay: 250,
			method: 'GET',
			data: function(params) {
				return { q : params.term }
			},
			processResults :  function(data, params) {
				var results =_.map(data, function (el) {
					return {
						id: el["id"] ,
						text: el["name"]
					}
				});
				return { results: results };
			}
		},
		minimumInputLength : 2
	});
}
