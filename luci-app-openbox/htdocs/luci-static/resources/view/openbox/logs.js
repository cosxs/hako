'use strict';
'require view';
'require openbox.ui as openbox';
'require form';
'require rpc';
'require poll';
'require ui';

const callLogRead = rpc.declare({
	object: 'luci.openbox',
	method: 'log_read',
	params: [ 'name', 'offset' ],
	expect: { '': {} }
});

const LOGS = [
	{ name: 'app', title: _('Plugin log') },
	{ name: 'core', title: _('Core log') }
];

return view.extend({
	// one tab: today's log, refreshed every few seconds; "Clear" only empties
	// the view, after which just the lines written since are shown
	renderLog(log) {
		let offset = 0;
		let size = 0;

		const output = E('textarea', {
			'class': 'cbi-input-textarea',
			'style': 'width:100%;font-family:monospace;font-size:12px',
			'readonly': '',
			'wrap': 'off',
			'rows': 25
		});

		const refresh = () => callLogRead(log.name, offset).then((res) => {
			// the log was rotated or emptied since the view was cleared
			if ((res.size ?? 0) < offset)
				offset = 0;

			size = res.size ?? 0;
			output.value = res.content ?? '';
			output.scrollTop = output.scrollHeight;
		});

		const clear = () => {
			offset = size;
			output.value = '';
		};

		poll.add(refresh, 5);
		refresh();

		return E('div', { 'data-tab': log.name, 'data-tab-title': log.title }, [
			E('div', { 'style': 'display:flex;justify-content:flex-end;margin-bottom:8px' }, [
				E('button', {
					'class': 'cbi-button',
					'title': _('Only clears what is shown here; the log file is kept.'),
					'click': clear
				}, _('Clear'))
			]),
			output
		]);
	},

	render() {
		const m = new form.Map('openbox');

		const s = m.section(form.NamedSection, 'logs', 'openbox', _('Log settings'));
		let o = s.option(form.Flag, 'auto_clean', _('Clean up logs automatically'));
		o.default = '1';
		o.rmempty = false;

		o = s.option(form.Value, 'retention_days', _('Keep logs for'));
		openbox.suffix(o, _('days'));
		o.datatype = 'range(1,365)';
		o.default = '7';
		o.depends('auto_clean', '1');

		// the tab menu goes in front of the tab group, inside its parent, so
		// the group must have one before the tabs are set up
		const tabs = E('div', {}, LOGS.map((log) => this.renderLog(log)));
		const section = E('div', { 'class': 'cbi-section' }, [ tabs ]);
		ui.tabs.initTabGroup(tabs.childNodes);

		return m.render().then((node) => E([], [ ...openbox.header(), node, section ]));
	}
});
