'use strict';
'require view';
'require openbox.ui as openbox';
'require rpc';
'require ui';
'require dom';

const callProfiles = rpc.declare({
	object: 'luci.openbox',
	method: 'profiles',
	expect: { '': {} }
});

const callRead = rpc.declare({
	object: 'luci.openbox',
	method: 'profile_read',
	params: [ 'name' ],
	expect: { '': {} }
});

const callGenerated = rpc.declare({
	object: 'luci.openbox',
	method: 'generated',
	expect: { '': {} }
});

const callCheck = rpc.declare({
	object: 'luci.openbox',
	method: 'profile_check',
	params: [ 'content' ],
	expect: { '': {} }
});

const callSave = rpc.declare({
	object: 'luci.openbox',
	method: 'profile_save',
	params: [ 'name', 'content' ],
	expect: { '': {} }
});

const callDelete = rpc.declare({
	object: 'luci.openbox',
	method: 'profile_delete',
	params: [ 'name' ],
	expect: { '': {} }
});

const callUse = rpc.declare({
	object: 'luci.openbox',
	method: 'profile_use',
	params: [ 'name' ],
	expect: { '': {} }
});

const callSubscriptionSave = rpc.declare({
	object: 'luci.openbox',
	method: 'subscription_save',
	params: [ 'file', 'url', 'update_interval' ],
	expect: { '': {} }
});

const callSubscriptionUpdate = rpc.declare({
	object: 'luci.openbox',
	method: 'subscription_update',
	params: [ 'file' ],
	expect: { '': {} }
});

// the same rule as the backend; also safe to pass to the shell
const PROFILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}\.json$/;

const errors = {
	invalid_name: _('Invalid file name.'),
	invalid_json: _('The file is not valid JSON.'),
	check_failed: _('sing-box check failed.'),
	generate_failed: _('Unable to generate the config.'),
	not_found: _('The file does not exist.'),
	in_use: _('The profile in use cannot be deleted.'),
	write_failed: _('Unable to write the file.'),
	exists: _('A profile with this name exists and is not a subscription.'),
	invalid_url: _('Expecting an http:// or https:// URL.'),
	invalid_interval: _('Invalid update interval.'),
	download_failed: _('Download failed.'),
	busy: _('Another update is running; try again later.'),
	update_failed: _('Update failed.')
};

const validateName = (value) => PROFILE_NAME.test(value) ? true : _('Letters, digits, dot, dash and underscore, ending in .json.');

// the units of the update interval, a sing-box duration
const DURATION_UNITS = { s: 1, m: 60, h: 3600, d: 86400 };

// the update interval in whole hours, or null when it is none
function intervalHours(value) {
	const parts = String(value ?? '').match(/\d+[smhd]/g);
	if (!parts || parts.join('') != value)
		return null;

	const seconds = parts.reduce((sum, part) => sum + parseInt(part) * DURATION_UNITS[part.slice(-1)], 0);
	return (seconds % 3600 == 0) ? seconds / 3600 : null;
}

function errorText(res) {
	return errors[res?.error] ?? res?.error ?? _('Unknown error');
}

function timeText(mtime) {
	const d = new Date(mtime * 1000);
	return '%04d-%02d-%02d %02d:%02d'.format(d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes());
}

function download(name, content) {
	const link = E('a', {
		'href': URL.createObjectURL(new Blob([ content ], { type: 'application/json' })),
		'download': name
	});

	document.body.appendChild(link);
	link.click();
	link.remove();
}

function button(title, handler, style) {
	return E('button', {
		'class': 'btn cbi-button cbi-button-%s'.format(style ?? 'neutral'),
		'click': handler
	}, title);
}

function output(text) {
	return E('pre', { 'style': 'white-space:pre-wrap;max-height:240px;overflow:auto;font-size:12px' }, text);
}

return view.extend({
	load() {
		return callProfiles();
	},

	refresh() {
		return callProfiles().then((data) => {
			this.data = data;
			dom.content(this.table, this.renderRows());
		});
	},

	inUse(name) {
		return name ? (this.data.source == 'profile' && this.data.profile == name) : this.data.source != 'profile';
	},

	subscription(name) {
		return (this.data.profiles ?? []).find((profile) => profile.name == name)?.subscription ?? null;
	},

	// the URL and the last update of a subscription, below its name
	renderSubscription(sub) {
		const hours = intervalHours(sub.update_interval);
		let schedule;

		if (!sub.update_interval || sub.update_interval == '0')
			schedule = _('Updated by hand');
		else if (hours != null)
			schedule = (hours == 1) ? _('Updated every hour') : _('Updated every %d hours').format(hours);
		else
			schedule = _('Updated every %s').format(sub.update_interval);

		let last;
		if (sub.last_error)
			last = E('span', { 'style': 'color:var(--error-color-medium, #c00)' }, '%h'.format(_('Last update failed: %s').format(sub.last_error)));
		else if (sub.last_update)
			last = _('last %s').format(timeText(sub.last_update));
		else
			last = _('not updated yet');

		return E('div', { 'class': 'cbi-value-description', 'style': 'font-size:90%' }, [
			E('div', {
				'title': sub.url,
				'style': 'max-width:360px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap'
			}, '%h'.format(sub.url)),
			E('div', {}, [ schedule, ' · ', last ])
		]);
	},

	// a profile, or the generated config without a name
	renderRow(profile) {
		const name = profile?.name ?? null;
		const sub = profile?.subscription ?? null;
		const inUse = this.inUse(name);
		const actions = [];

		if (!inUse)
			actions.push(button(_('Use'), ui.createHandlerFn(this, 'handleUse', name), 'apply'));

		if (sub)
			actions.push(button(_('Update'), ui.createHandlerFn(this, 'handleUpdate', name), 'action'));

		if (name) {
			actions.push(button(_('Edit'), ui.createHandlerFn(this, 'handleEdit', name), 'edit'));
			actions.push(button(_('Download'), ui.createHandlerFn(this, 'handleDownload', name)));
			if (!inUse)
				actions.push(button(_('Delete'), ui.createHandlerFn(this, 'handleDelete', name), 'remove'));
		}
		else {
			actions.push(button(_('View'), ui.createHandlerFn(this, 'handleView'), 'edit'));
		}

		return E('tr', { 'class': 'tr' }, [
			E('td', { 'class': 'td' }, name ? (sub ? [ name, this.renderSubscription(sub) ] : '%h'.format(name)) : [
				E('strong', {}, _('Generated by OpenBox')),
				E('div', { 'class': 'cbi-value-description' }, _('From the settings on the Takeover, Policies, Route rules and Core settings pages.'))
			]),
			E('td', { 'class': 'td' }, name ? '%1024.1mB'.format(profile.size) : '-'),
			E('td', { 'class': 'td' }, name ? timeText(profile.mtime) : '-'),
			E('td', { 'class': 'td' }, inUse ? E('strong', {}, _('In use')) : ''),
			E('td', { 'class': 'td cbi-section-actions' }, E('div', {}, actions))
		]);
	},

	renderRows() {
		return [
			E('tr', { 'class': 'tr table-titles' }, [
				E('th', { 'class': 'th' }, _('Name')),
				E('th', { 'class': 'th' }, _('Size')),
				E('th', { 'class': 'th' }, _('Modified')),
				E('th', { 'class': 'th' }, _('Status')),
				E('th', { 'class': 'th cbi-section-actions' }, '')
			]),
			this.renderRow(null),
			...(this.data.profiles ?? []).map((profile) => this.renderRow(profile))
		];
	},

	// the editor below the table: a profile, or the generated config read-only
	openEditor(name, content, notes) {
		const textarea = E('textarea', {
			'class': 'cbi-input-textarea',
			'style': 'width:100%;font-family:monospace;font-size:12px;tab-size:4',
			'rows': 25,
			'wrap': 'off',
			'spellcheck': 'false',
			'readonly': name ? null : ''
		}, [ content ]);
		const status = E('div', {}, notes ?? '');

		this.editing = { name: name, saved: content, textarea: textarea, status: status };

		const actions = [ button(_('Close'), ui.createHandlerFn(this, 'handleClose')) ];
		if (name) {
			actions.push(button(_('Check'), ui.createHandlerFn(this, 'handleCheck')));
			actions.push(button(this.inUse(name) ? _('Save and reload') : _('Save'), ui.createHandlerFn(this, 'handleSaveProfile'), 'save'));
		}
		else {
			actions.push(button(_('Download'), () => download('openbox.json', content)));
		}

		dom.content(this.editor, E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, name ? _('Edit: %s').format(name) : _('Generated config (read-only)')),
			(name && this.subscription(name))
				? E('div', { 'class': 'alert-message notice' }, _('This is a subscription; its next update replaces the changes made here.'))
				: '',
			status,
			textarea,
			E('div', { 'class': 'right', 'style': 'margin-top:8px;display:flex;gap:6px;justify-content:flex-end' }, actions)
		]));
		this.editor.scrollIntoView();
	},

	closeEditor() {
		this.editing = null;
		dom.content(this.editor, '');
	},

	// asks before unsaved changes are dropped
	confirmDiscard() {
		const editing = this.editing;
		if (!editing?.name || editing.textarea.value == editing.saved)
			return Promise.resolve(true);

		return new Promise((resolve) => {
			ui.showModal(_('Discard changes?'), [
				E('p', {}, _('The changes to %s are not saved.').format(editing.name)),
				E('div', { 'class': 'right' }, [
					button(_('Cancel'), () => { ui.hideModal(); resolve(false); }),
					' ',
					button(_('Discard'), () => { ui.hideModal(); resolve(true); }, 'remove')
				])
			]);
		});
	},

	showError(title, res) {
		ui.showModal(title, [
			E('p', {}, errorText(res)),
			res?.output ? output(res.output) : '',
			E('div', { 'class': 'right' }, button(_('Close'), ui.hideModal))
		]);
	},

	// asks for a file name; an existing file is replaced after a warning
	askName(title, suggested) {
		const field = new ui.Textfield(suggested ?? '', {
			placeholder: 'example.json',
			validate: validateName
		});

		return new Promise((resolve) => {
			const ok = () => {
				const name = field.getValue();
				if (!field.isValid())
					return;

				if (this.inUse(name)) {
					ui.addNotification(null, E('p', _('The profile in use cannot be replaced here; edit it instead.')), 'warning');
					return;
				}

				ui.hideModal();
				resolve(name);
			};

			const input = field.render();

			ui.showModal(title, [
				E('p', {}, _('File name')),
				input,
				E('p', { 'class': 'cbi-value-description' }, _('A file with the same name is replaced.')),
				E('div', { 'class': 'right' }, [
					button(_('Cancel'), () => { ui.hideModal(); resolve(null); }),
					' ',
					button(_('OK'), ok, 'save')
				])
			]);

			input.querySelector('input')?.focus();
		});
	},

	handleUse(name) {
		return callUse(name).then((res) => {
			if (!res.result)
				return this.showError(_('Unable to switch the config'), res);

			ui.addNotification(null, E('p', res.reloaded ? _('Switched; sing-box was reloaded.') : _('Switched; used when OpenBox starts.')), 'info');

			// the save button of an open profile follows whether it is in use
			return this.refresh().then(() => {
				const editing = this.editing;
				if (editing?.name) {
					const saved = editing.saved;
					this.openEditor(editing.name, editing.textarea.value);
					this.editing.saved = saved;
				}
			});
		});
	},

	handleView() {
		return this.confirmDiscard().then((ok) => ok && callGenerated().then((res) => {
			if (!res.content)
				return this.showError(_('Unable to generate the config'), { error: res.error, output: res.warnings });

			this.openEditor(null, res.content, res.warnings ? E('div', { 'class': 'alert-message warning' }, output(res.warnings)) : null);
		}));
	},

	handleEdit(name) {
		return this.confirmDiscard().then((ok) => ok && callRead(name).then((res) => {
			if (res.content == null)
				return this.showError(_('Unable to read %s').format(name), res);

			this.openEditor(name, res.content);
		}));
	},

	handleDownload(name) {
		return callRead(name).then((res) => {
			if (res.content == null)
				return this.showError(_('Unable to read %s').format(name), res);

			download(name, res.content);
		});
	},

	handleDelete(name) {
		ui.showModal(_('Delete %s?').format(name), [
			E('p', {}, _('The file is removed from the router.')),
			E('div', { 'class': 'right' }, [
				button(_('Cancel'), ui.hideModal),
				' ',
				button(_('Delete'), () => callDelete(name).then((res) => {
					ui.hideModal();
					if (!res.result)
						return this.showError(_('Unable to delete %s').format(name), res);

					if (this.editing?.name == name)
						this.closeEditor();

					return this.refresh();
				}), 'remove')
			])
		]);
	},

	// a new profile starts from the generated config
	handleNew() {
		return this.confirmDiscard().then((ok) => ok && this.askName(_('New profile')).then((name) => name && callGenerated().then((res) => {
			if (!res.content)
				return this.showError(_('Unable to generate the config'), { error: res.error, output: res.warnings });

			return this.saveNew(name, res.content);
		})));
	},

	handleUpload(ev) {
		const file = ev.target.files?.[0];
		ev.target.value = '';
		if (!file)
			return;

		return this.confirmDiscard().then((ok) => ok && file.text().then((content) =>
			this.askName(_('Upload profile'), file.name).then((name) => name && this.saveNew(name, content))));
	},

	saveNew(name, content) {
		return callSave(name, content).then((res) => {
			if (!res.result)
				return this.showError(_('Unable to save %s').format(name), res);

			return this.refresh().then(() => this.openEditor(name, content));
		});
	},

	// adds a subscription, or with the name of one changes its URL and interval
	handleSubscribe() {
		const name = new ui.Textfield('sub.json', { placeholder: 'sub.json', validate: validateName });
		const url = new ui.Textfield('', {
			placeholder: 'https://',
			validate: (value) => /^https?:\/\/[^\s\/]+\S*$/.test(value) ? true : _('Expecting an http:// or https:// URL.')
		});
		const interval = new ui.Textfield('24', {
			validate: (value) => /^\d+$/.test(value) ? true : _('Expecting a whole number')
		});

		// a failure is shown in the dialog, which keeps what was entered
		const status = E('div');

		const ok = () => {
			if (!name.isValid() || !url.isValid() || !interval.isValid())
				return;

			dom.content(status, '');

			const file = name.getValue();
			const hours = parseInt(interval.getValue());

			return callSubscriptionSave(file, url.getValue().trim(), hours > 0 ? '%dh'.format(hours) : '0').then((res) => {
				if (!res.result)
					return dom.content(status, E('div', { 'class': 'alert-message warning' }, [
						E('p', {}, errorText(res)),
						res.output ? output(res.output) : ''
					]));

				ui.hideModal();
				ui.addNotification(null, E('p', res.reloaded
					? _('%s downloaded; sing-box was reloaded.').format(file)
					: _('%s downloaded.').format(file)), 'info');

				return this.refresh();
			});
		};

		ui.showModal(_('Subscribe'), [
			E('p', {}, _('A URL that returns a full sing-box JSON config. It is downloaded as a profile and updated while OpenBox runs.')),
			E('div', { 'class': 'cbi-value' }, [
				E('label', { 'class': 'cbi-value-title' }, _('File name')),
				E('div', { 'class': 'cbi-value-field' }, [
					name.render(),
					E('div', { 'class': 'cbi-value-description' }, _('The name of an existing subscription changes its URL and interval.'))
				])
			]),
			E('div', { 'class': 'cbi-value' }, [
				E('label', { 'class': 'cbi-value-title' }, _('URL')),
				E('div', { 'class': 'cbi-value-field' }, url.render())
			]),
			E('div', { 'class': 'cbi-value' }, [
				E('label', { 'class': 'cbi-value-title' }, _('Update interval')),
				E('div', { 'class': 'cbi-value-field' }, [
					E('div', { 'style': 'display:flex;align-items:center;gap:6px' }, [ interval.render(), E('span', {}, _('hours')) ]),
					E('div', { 'class': 'cbi-value-description' }, _('0 updates only by hand.'))
				])
			]),
			status,
			E('div', { 'class': 'right' }, [
				button(_('Cancel'), ui.hideModal),
				' ',
				button(_('OK'), ui.createHandlerFn(this, ok), 'save')
			])
		]);
	},

	handleUpdate(name) {
		return callSubscriptionUpdate(name).then((res) => {
			if (!res.result)
				this.showError(_('Unable to update %s').format(name), res);
			else if (!res.changed)
				ui.addNotification(null, E('p', _('%s is up to date.').format(name)), 'info');
			else
				ui.addNotification(null, E('p', res.reloaded
					? _('%s updated; sing-box was reloaded.').format(name)
					: _('%s updated.').format(name)), 'info');

			// an open file without changes shows what was downloaded
			const editing = this.editing;
			const reopen = res.changed && editing?.name == name && editing.textarea.value == editing.saved;

			return this.refresh().then(() => reopen && callRead(name).then((read) => {
				if (read.content != null && this.editing === editing)
					this.openEditor(name, read.content);
			}));
		});
	},

	handleCheck() {
		const editing = this.editing;

		return callCheck(editing.textarea.value).then((res) => {
			dom.content(editing.status, res.result
				? E('div', { 'class': 'alert-message success' }, _('sing-box check passed.'))
				: E('div', { 'class': 'alert-message warning' }, [ E('p', {}, errorText(res)), res.output ? output(res.output) : '' ]));
		});
	},

	handleSaveProfile() {
		const editing = this.editing;
		const content = editing.textarea.value;

		return callSave(editing.name, content).then((res) => {
			if (!res.result)
				return this.showError(_('Unable to save %s').format(editing.name), res);

			editing.saved = content;
			dom.content(editing.status, '');
			ui.addNotification(null, E('p', res.reloaded ? _('Saved; sing-box was reloaded.') : _('Saved.')), 'info');

			return this.refresh();
		});
	},

	handleClose() {
		return this.confirmDiscard().then((ok) => ok && this.closeEditor());
	},

	render(data) {
		this.data = data;
		this.table = E('table', { 'class': 'table' }, this.renderRows());
		// a section only while a file is open
		this.editor = E('div');

		const upload = E('input', {
			'type': 'file',
			'accept': '.json,application/json',
			'style': 'display:none',
			'change': ui.createHandlerFn(this, 'handleUpload')
		});

		return E([], [
			...openbox.header(),
			E('div', { 'class': 'cbi-section' }, [
				E('div', { 'class': 'cbi-section-descr' }, _('OpenBox generates the sing-box config from its settings, or runs a native sing-box JSON profile from /etc/openbox/profiles as it is.')),
				this.table,
				E('div', { 'style': 'display:flex;gap:6px;margin-top:8px' }, [
					button(_('New'), ui.createHandlerFn(this, 'handleNew'), 'add'),
					button(_('Upload…'), () => upload.click(), 'add'),
					button(_('Subscribe…'), ui.createHandlerFn(this, 'handleSubscribe'), 'add'),
					upload
				])
			]),
			this.editor
		]);
	},

	// the page saves files itself, not UCI
	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
