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

const callCreate = rpc.declare({
	object: 'luci.openbox',
	method: 'profile_create',
	params: [ 'name' ],
	expect: { '': {} }
});

const callView = rpc.declare({
	object: 'luci.openbox',
	method: 'profile_view',
	params: [ 'name' ],
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

// the same rule as the backend: the name is part of a UCI package name
const PROFILE_NAME = /^[a-z0-9_]{1,32}$/;

const errors = {
	invalid_name: _('Lowercase letters, digits and underscores, up to 32.'),
	exists: _('A profile with this name exists.'),
	write_failed: _('Unable to write the profile.'),
	not_found: _('The profile does not exist.'),
	in_use: _('The profile in use cannot be deleted.'),
	generate_failed: _('Unable to generate the config.'),
	check_failed: _('sing-box check failed.')
};

// the menu of a profile and the tags of the table
const STYLE = `
.openbox-tag { display: inline-block; padding: 0 6px; border-radius: 3px; font-size: 12px; line-height: 1.6; }
.openbox-tag.local { background: #eeeeee; color: #444444; }
.openbox-tag.in-use { background: #2e7d32; color: #ffffff; }
.openbox-name { padding: 0; border: 0; background: none; color: var(--primary-color-high, #0069d6); font: inherit; cursor: pointer; text-align: left; }
.openbox-name:hover { text-decoration: underline; }
.openbox-more { position: relative; display: inline-block; }
.openbox-more-menu { position: absolute; right: 0; top: 100%; z-index: 100; min-width: 150px; margin-top: 4px; padding: 4px; border: 1px solid var(--border-color-medium, #cccccc); border-radius: 6px; background: var(--background-color-high, #ffffff); box-shadow: 0 8px 24px rgba(0, 0, 0, .18); text-align: left; }
.openbox-more-item { display: block; box-sizing: border-box; width: 100%; margin: 0; padding: 6px 12px; border: 0; border-radius: 4px; background: none; color: inherit; font: inherit; font-size: 13px; text-align: left; cursor: pointer; }
.openbox-more-item:hover, .openbox-more-item:focus-visible { background: var(--primary-color-high, #0069d6); color: #ffffff; outline: none; }
.openbox-more-item.danger { color: #c43c35; }
`;

function errorText(res) {
	return errors[res?.error] ?? res?.error ?? _('Unknown error');
}

function button(title, handler, style) {
	return E('button', {
		'type': 'button',
		'class': 'btn cbi-button cbi-button-%s'.format(style ?? 'neutral'),
		'click': handler
	}, title);
}

function output(text) {
	return E('pre', { 'style': 'white-space:pre-wrap;max-height:240px;overflow:auto;font-size:12px' }, text);
}

function failed(title, res) {
	ui.showModal(title, [
		E('p', {}, errorText(res)),
		res?.output ? output(res.output) : '',
		E('div', { 'class': 'right' }, button(_('Close'), ui.hideModal))
	]);
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

	handleUse(name) {
		return callUse(name).then((res) => {
			if (!res.result)
				return failed(_('Unable to use %s').format(name), res);

			ui.addTimeLimitedNotification(null, E('p', res.reloaded ? _('Switched; sing-box was reloaded.') : _('Switched; used when OpenBox starts.')), 5000, 'info');

			// the settings pages edit the profile in use: load them anew
			return this.refresh();
		});
	},

	// the config the profile makes, read-only
	handleView(name) {
		return callView(name).then((res) => {
			ui.showModal(_('View: %s').format(name), [
				res.content
					? E('pre', { 'style': 'max-height:60vh;overflow:auto;font-size:12px;white-space:pre' }, res.content)
					: E('p', {}, errorText(res)),
				res.warnings ? E('div', { 'class': 'alert-message warning' }, output(res.warnings)) : '',
				E('div', { 'class': 'right' }, button(_('Close'), ui.hideModal, 'positive'))
			]);
		});
	},

	handleDelete(name) {
		ui.showModal(_('Delete %s?').format(name), [
			E('p', {}, _('The profile and its nodes, groups and rules are deleted.')),
			E('div', { 'class': 'right', 'style': 'display:flex;gap:6px;justify-content:flex-end' }, [
				button(_('Cancel'), ui.hideModal),
				button(_('Delete'), () => callDelete(name).then((res) => {
					ui.hideModal();
					if (!res.result)
						return failed(_('Unable to delete %s').format(name), res);

					return this.refresh();
				}), 'negative')
			])
		]);
	},

	// a new profile: its name and where it comes from; the default config is
	// the template built into OpenBox
	handleNew() {
		const name = E('input', { 'type': 'text', 'class': 'cbi-input-text', 'style': 'width:260px' });
		const message = E('div', { 'class': 'cbi-value-description' });
		const row = (label, field) => E('div', { 'class': 'cbi-value' }, [
			E('label', { 'class': 'cbi-value-title' }, label),
			E('div', { 'class': 'cbi-value-field' }, field)
		]);

		const create = () => {
			if (!PROFILE_NAME.test(name.value)) {
				message.textContent = errors.invalid_name;
				return;
			}

			return callCreate(name.value).then((res) => {
				if (!res.result) {
					message.textContent = errorText(res);
					return;
				}

				ui.hideModal();
				return this.refresh();
			});
		};

		ui.showModal(_('New profile'), [
			row(_('Profile name'), [ name, message ]),
			row(_('Source'), E('label', { 'style': 'display:inline-flex;align-items:center;gap:6px' }, [
				E('input', { 'type': 'radio', 'name': 'openbox-source', 'checked': '' }),
				_('Default config')
			])),
			E('div', { 'class': 'right', 'style': 'display:flex;gap:6px;justify-content:flex-end' }, [
				button(_('Cancel'), ui.hideModal),
				button(_('Create'), ui.createHandlerFn(this, create), 'positive')
			])
		]);

		name.focus();
	},

	closeMenu() {
		if (!this.menu)
			return;

		this.menu.remove();
		this.menu = null;
		document.removeEventListener('mousedown', this.closeOutside, true);
	},

	// the less common actions of a profile, below its "More" button
	toggleMenu(name, inUse, anchor) {
		const open = this.menu?.parentNode == anchor;

		this.closeMenu();
		if (open)
			return;

		const item = (label, run, danger) => E('button', {
			'type': 'button',
			'role': 'menuitem',
			'class': 'openbox-more-item' + (danger ? ' danger' : ''),
			'click': () => {
				this.closeMenu();
				run();
			}
		}, label);

		this.menu = E('div', { 'class': 'openbox-more-menu', 'role': 'menu' }, [
			item(_('View'), () => this.handleView(name)),
			inUse ? '' : item(_('Delete'), () => this.handleDelete(name), true)
		]);

		anchor.appendChild(this.menu);
		document.addEventListener('mousedown', this.closeOutside, true);
	},

	renderRows() {
		const rows = (this.data.profiles ?? []).map((profile) => {
			const name = profile.name;
			const inUse = name == this.data.profile;
			const more = E('span', { 'class': 'openbox-more' });

			more.appendChild(E('button', {
				'type': 'button',
				'class': 'btn cbi-button',
				'aria-haspopup': 'menu',
				'click': () => this.toggleMenu(name, inUse, more)
			}, _('More') + ' ▾'));

			return E('tr', { 'class': 'tr' }, [
				E('td', { 'class': 'td' }, E('button', {
					'type': 'button',
					'class': 'openbox-name',
					'click': ui.createHandlerFn(this, 'handleView', name)
				}, '%h'.format(name))),
				E('td', { 'class': 'td' }, E('span', { 'class': 'openbox-tag local' }, _('Local'))),
				E('td', { 'class': 'td' }, inUse ? E('span', { 'class': 'openbox-tag in-use' }, _('In use')) : ''),
				E('td', { 'class': 'td right', 'style': 'white-space:nowrap' }, [
					inUse ? '' : button(_('Use'), ui.createHandlerFn(this, 'handleUse', name), 'action'),
					' ',
					more
				])
			]);
		});

		return [
			E('tr', { 'class': 'tr table-titles' }, [
				E('th', { 'class': 'th' }, _('Name')),
				E('th', { 'class': 'th', 'style': 'width:120px' }, _('Type')),
				E('th', { 'class': 'th', 'style': 'width:90px' }, _('Status')),
				E('th', { 'class': 'th', 'style': 'width:170px' })
			]),
			...rows
		];
	},

	render(data) {
		this.data = data;
		this.menu = null;
		this.closeOutside = (ev) => {
			if (this.menu && !this.menu.parentNode.contains(ev.target))
				this.closeMenu();
		};
		this.table = E('table', { 'class': 'table' });
		dom.content(this.table, this.renderRows());

		return E([], [
			E('style', {}, STYLE),
			...openbox.header(),
			E('div', { 'class': 'cbi-section' }, [
				this.table,
				E('div', { 'style': 'margin-top:10px' }, button(_('New…'), () => this.handleNew(), 'add'))
			])
		]);
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null
});
