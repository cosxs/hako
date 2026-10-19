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
  params: [ 'title' ],
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

const callSubscriptionSave = rpc.declare({
  object: 'luci.openbox',
  method: 'subscription_save',
  params: [ 'title', 'url', 'update_interval', 'user_agent' ],
  expect: { '': {} }
});

const callSubscriptionUpdate = rpc.declare({
  object: 'luci.openbox',
  method: 'subscription_update',
  params: [ 'name' ],
  expect: { '': {} }
});

const errors = {
  invalid_title: _('Expecting a name.'),
  exists: _('A profile with this name exists.'),
  write_failed: _('Unable to write the profile.'),
  not_found: _('The profile does not exist.'),
  in_use: _('The profile in use cannot be deleted.'),
  generate_failed: _('Unable to generate the config.'),
  check_failed: _('sing-box check failed.'),
  invalid_url: _('Expecting an http:// or https:// URL.'),
  invalid_interval: _('Invalid update interval.'),
  invalid_user_agent: _('Invalid User-Agent.'),
  download_failed: _('Download failed.'),
  invalid_json: _('The download is not a JSON config.'),
  busy: _('Another update is running; try again later.'),
  update_failed: _('Update failed.')
};

// the menu of a profile and the tags of the table
const STYLE = `
.openbox-tag { display: inline-block; padding: 0 6px; border-radius: 3px; font-size: 12px; line-height: 1.6; }
.openbox-tag.local { background: #eeeeee; color: #444444; }
.openbox-tag.subscription { background: #e6f4ea; color: #1e6b34; }
.openbox-error { margin-top: 2px; color: #c43c35; font-size: 12px; }
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

  // what the page shows of a profile, its title
  title(name) {
    return this.profile(name)?.title ?? name;
  },

  handleUse(name) {
    return callUse(name).then((res) => {
      if (!res.result)
        return failed(_('Unable to use %s').format(this.title(name)), res);

      ui.addTimeLimitedNotification(null, E('p', res.reloaded ? _('Switched; sing-box was reloaded.') : _('Switched; used when OpenBox starts.')), 5000, 'info');

      // the settings pages edit the profile in use: load them anew
      return this.refresh();
    });
  },

  handleUpdate(name) {
    return callSubscriptionUpdate(name).then((res) => {
      if (!res.result)
        return failed(_('Unable to update %s').format(this.title(name)), res);

      const title = '%h'.format(this.title(name));
      ui.addTimeLimitedNotification(null, E('p', !res.changed ? _('%s is up to date.').format(title)
        : res.reloaded ? _('%s updated; sing-box was reloaded.').format(title) : _('%s updated.').format(title)), 5000, 'info');

      return this.refresh();
    });
  },

  // the config the profile makes, read-only, indented with two spaces
  handleView(name) {
    return callView(name).then((res) => {
      let content = res.content;
      try {
        content = JSON.stringify(JSON.parse(content), null, 2);
      }
      catch (e) {}

      const url = this.profile(name)?.url;

      ui.showModal(_('View: %s').format(this.title(name)), [
        url ? this.renderUrl(url) : '',
        content
          ? E('pre', { 'style': 'max-height:60vh;overflow:auto;font-size:12px;white-space:pre' }, '%h'.format(content))
          : E('p', {}, errorText(res)),
        res.warnings ? E('div', { 'class': 'alert-message warning' }, output(res.warnings)) : '',
        E('div', { 'class': 'right' }, button(_('Close'), ui.hideModal, 'positive'))
      ]);
    });
  },

  // the URL of a subscription, read-only, with a button that copies it
  renderUrl(url) {
    const input = E('input', {
      'type': 'text',
      'class': 'cbi-input-text',
      'readonly': '',
      'value': url,
      'style': 'flex:1;min-width:0',
      'click': (ev) => ev.target.select()
    });

    const copy = () => {
      // without HTTPS the browser offers no clipboard API: copy the
      // selected text then
      const copied = navigator.clipboard?.writeText(url) ?? new Promise((resolve, reject) => {
        input.select();
        document.execCommand('copy') ? resolve() : reject();
      });

      return copied.then(() => ui.addTimeLimitedNotification(null, E('p', _('Copied.')), 3000, 'info'),
        () => ui.addTimeLimitedNotification(null, E('p', _('Unable to copy; select the URL and copy it by hand.')), 5000, 'warning'));
    };

    return E('div', { 'style': 'display:flex;align-items:center;gap:8px;margin-bottom:10px' }, [
      E('label', { 'style': 'flex:none' }, _('Subscription URL')),
      input,
      button(_('Copy'), copy)
    ]);
  },

  handleDelete(name) {
    ui.showModal(_('Delete %s?').format(this.title(name)), [
      E('p', {}, (this.profile(name)?.type == 'subscription')
        ? _('The profile, its groups and rules, and what its subscription downloaded are deleted.')
        : _('The profile and its nodes, groups and rules are deleted.')),
      E('div', { 'class': 'right', 'style': 'display:flex;gap:6px;justify-content:flex-end' }, [
        button(_('Cancel'), ui.hideModal),
        button(_('Delete'), () => callDelete(name).then((res) => {
          ui.hideModal();
          if (!res.result)
            return failed(_('Unable to delete %s').format(this.title(name)), res);

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
      if (!name.value.trim()) {
        message.textContent = errors.invalid_title;
        return;
      }

      // a subscription is downloaded right away; hours are kept as a
      // sing-box duration, none updates only by hand
      const subscribe = document.querySelector('input[name="openbox-source"]:checked')?.value == 'subscription';
      if (subscribe && !/^\d*$/.test(hours.value.trim())) {
        message.textContent = errors.invalid_interval;
        return;
      }

      const interval = (+hours.value > 0) ? hours.value.trim() + 'h' : '';
      const call = subscribe ? callSubscriptionSave(name.value.trim(), url.value.trim(), interval, agent.value.trim()) : callCreate(name.value.trim());

      return call.then((res) => {
        if (!res.result) {
          message.textContent = errorText(res);
          return;
        }

        ui.hideModal();
        return this.refresh();
      });
    };

    const url = E('input', { 'type': 'url', 'class': 'cbi-input-text', 'style': 'width:100%', 'placeholder': 'https://example.com/sing-box.json' });
    const hours = E('input', { 'type': 'text', 'class': 'cbi-input-text', 'style': 'width:80px', 'placeholder': '24' });
    const agent = E('input', { 'type': 'text', 'class': 'cbi-input-text', 'style': 'width:100%', 'placeholder': 'sing-box/1.14 OpenBox/0.1' });
    const subRows = E('div', { 'style': 'display:none' }, [
      row(_('Subscription URL'), url),
      row(_('Update interval'), E('span', {}, [ hours, ' ', _('hours') ])),
      row(_('User-Agent'), [ agent, E('div', { 'class': 'cbi-value-description' }, _('Some providers answer in the format the User-Agent asks for; the default names sing-box and OpenBox.')) ])
    ]);
    const source = (value, label, checked) => E('label', { 'style': 'display:inline-flex;align-items:center;gap:6px;margin-right:20px' }, [
      E('input', {
        'type': 'radio', 'name': 'openbox-source', 'value': value, 'checked': checked ? '' : null,
        'change': () => subRows.style.display = (value == 'subscription') ? '' : 'none'
      }),
      label
    ]);

    ui.showModal(_('New profile'), [
      row(_('Profile name'), [ name, message ]),
      row(_('Profile source'), [ source('default', _('Default config'), true), source('subscription', _('Remote subscription')) ]),
      subRows,
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

    const subscription = this.profile(name)?.type == 'subscription';

    this.menu = E('div', { 'class': 'openbox-more-menu', 'role': 'menu' }, [
      item(_('View'), () => this.handleView(name)),
      subscription ? item(_('Update'), () => this.handleUpdate(name)) : '',
      inUse ? '' : item(_('Delete'), () => this.handleDelete(name), true)
    ]);

    anchor.appendChild(this.menu);
    document.addEventListener('mousedown', this.closeOutside, true);
  },

  profile(name) {
    return (this.data.profiles ?? []).find((profile) => profile.name == name);
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
        E('td', { 'class': 'td' }, [
          E('button', {
            'type': 'button',
            'class': 'openbox-name',
            'click': ui.createHandlerFn(this, 'handleView', name)
          }, '%h'.format(profile.title ?? name)),
          profile.last_error ? E('div', { 'class': 'openbox-error' }, _('Last update failed: %s').format('%h'.format(profile.last_error))) : ''
        ]),
        E('td', { 'class': 'td' }, (profile.type == 'subscription')
          ? E('span', { 'class': 'openbox-tag subscription' }, _('Subscription'))
          : E('span', { 'class': 'openbox-tag local' }, _('Local'))),
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
