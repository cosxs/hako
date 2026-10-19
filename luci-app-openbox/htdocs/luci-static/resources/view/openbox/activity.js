'use strict';
'require view';
'require openbox.ui as openbox';
'require rpc';
'require poll';
'require ui';

const callStatus = rpc.declare({
  object: 'luci.openbox',
  method: 'status',
  expect: { '': {} }
});

const callControl = rpc.declare({
  object: 'luci.openbox',
  method: 'control',
  params: [ 'action' ],
  expect: { '': {} }
});

const callCoreLatest = rpc.declare({
  object: 'luci.openbox',
  method: 'core_latest',
  expect: { '': {} }
});

const callCoreInstall = rpc.declare({
  object: 'luci.openbox',
  method: 'core_install',
  params: [ 'source' ],
  expect: { '': {} }
});

const callModeSet = rpc.declare({
  object: 'luci.openbox',
  method: 'mode_set',
  params: [ 'mode' ],
  expect: { '': {} }
});

// the theme aligns radio buttons in form fields only, not in table cells
const MODE_STYLE = `
.openbox-mode { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 20px; }
.openbox-mode .cbi-radio { display: inline-flex; align-items: center; gap: 6px; }
.openbox-mode .cbi-radio input { margin: 0; }
`;

const CORE_UPLOAD = '/tmp/openbox-core-upload.apk';

const callCoreInstallStatus = rpc.declare({
  object: 'luci.openbox',
  method: 'core_install_status',
  expect: { '': {} }
});

function renderState(status) {
  if (!status.core?.installed)
    return E('span', { 'class': 'label' }, _('sing-box not installed'));

  if (!status.core.supported)
    return E('span', { 'class': 'label warning' }, _('sing-box too old'));

  if (status.running)
    return E('span', { 'class': 'label success' }, _('Running'));

  if (status.core.service_active)
    return E('span', { 'class': 'label warning' }, _('Not running: the service of the sing-box package is in use'));

  if (!status.enabled)
    return E('span', { 'class': 'label' }, _('Disabled'));

  return E('span', { 'class': 'label important' }, _('Not running'));
}

// the profile in use, linked to the profiles page
function renderSource(status) {
  return E('a', { 'href': L.url('admin/services/openbox/profiles') }, '%h'.format(status.profile_title ?? status.profile));
}

function renderTakeover(takeover) {
  const parts = [];

  if (takeover.tun)
    parts.push(_('TUN (%s)').format(takeover.tun));
  if (takeover.tproxy)
    parts.push(_('TProxy (%s)').format(takeover.tproxy));
  if (takeover.redirect)
    parts.push(_('Redirect (%s)').format(takeover.redirect));
  if (takeover.dns)
    parts.push(takeover.dns.port
      ? _('DNS hijack (%s :%d)').format(takeover.dns.tag, takeover.dns.port)
      : _('DNS hijack'));

  return parts.length ? parts.join(' · ') : _('None');
}

function renderCore(core) {
  if (!core?.installed)
    return E('span', { 'class': 'label' }, _('Not installed'));

  const text = core.version ?? '?';

  if (core.supported && core.service_active)
    return E('span', {}, [
      text, ' ',
      E('span', { 'class': 'label warning' }, _('Its own service runs or starts at boot'))
    ]);

  if (core.supported)
    return text;

  return E('span', {}, [
    text, ' ',
    E('span', { 'class': 'label warning' }, _('Version 1.14 or later required'))
  ]);
}

// the uptime in days, hours and minutes, leaving out the leading zero units
function formatUptime(seconds) {
  const minutes = Math.floor(seconds / 60);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor(minutes % 1440 / 60);

  if (days > 0)
    return _('%dd %dh %dm').format(days, hours, minutes % 60);
  if (hours > 0)
    return _('%dh %dm').format(hours, minutes % 60);
  return _('%dm').format(minutes);
}

// mode: the outbound mode row, a switch or the name of the only mode
function renderRows(status, mode) {
  const rows = [
    [ _('Status'), renderState(status) ],
    [ _('Configuration'), renderSource(status) ],
    [ _('Takeover'), renderTakeover(status.takeover ?? {}) ],
    [ _('Proxy port'), status.takeover?.mixed ? _('HTTP and SOCKS5 :%d').format(status.takeover.mixed.port) : null ],
    [ _('Outbound mode'), mode ],
    [ _('Uptime'), status.running && status.uptime != null ? formatUptime(status.uptime) : null ],
    [ _('Core version'), renderCore(status.core) ],
    [ _('Plugin version'), status.version ?? '?' ]
  ];

  return rows.filter(([ , value ]) => value != null).map(([ title, value ]) => E('tr', { 'class': 'tr' }, [
    E('td', { 'class': 'td left', 'width': '33%' }, title),
    E('td', { 'class': 'td left' }, value)
  ]));
}

return view.extend({
  load() {
    return callStatus();
  },

  // switches the outbound mode right away; the switch goes back when it fails
  handleMode(widget) {
    const mode = widget.getValue();
    const previous = this.mode;

    this.mode = mode;
    this.modeBusy = true;

    return callModeSet(mode).then((res) => {
      if (!res.result)
        throw res.error;
    }).catch(() => {
      ui.addNotification(null, E('p', _('Unable to switch the outbound mode.')), 'danger');
      this.mode = previous;
      widget.setValue(previous);
    }).then(() => {
      this.modeBusy = false;

      return this.refresh();
    });
  },

  // the outbound mode: a switch between the modes of the config, kept
  // across refreshes so a click is not lost; null without the clash API
  renderMode(api) {
    if (!api) {
      this.modeKey = null;
      return null;
    }

    // sing-box matches modes regardless of case
    const modes = [ ...(api.modes ?? []) ];
    const find = (value) => modes.find((mode) => mode.toLowerCase() == value?.toLowerCase());
    if (api.mode && !find(api.mode))
      modes.push(api.mode);

    const name = (mode) => openbox.modeNames[mode?.toLowerCase()] ?? mode;
    if (modes.length < 2) {
      this.modeKey = null;
      return name(api.mode);
    }

    // the modes of sing-box in a fixed order, those of the config after them
    const ORDER = [ 'rule', 'global', 'direct' ];
    const rank = (mode) => (ORDER.indexOf(mode.toLowerCase()) + ORDER.length + 1) % (ORDER.length + 1);
    modes.sort((a, b) => rank(a) - rank(b));

    const key = modes.join('\n');
    if (key != this.modeKey) {
      const choices = {};
      modes.forEach((mode) => choices[mode] = name(mode));

      this.modeKey = key;
      this.mode = find(api.mode);
      this.modeWidget = new ui.Select(this.mode, choices, { widget: 'radio', orientation: 'horizontal', name: 'openbox-mode' });
      this.modeNode = this.modeWidget.render();
      this.modeNode.classList.add('openbox-mode');
      // the gaps come from the style, not the spaces between the buttons
      for (const node of [ ...this.modeNode.childNodes ])
        if (node.nodeType == Node.TEXT_NODE)
          node.remove();
      this.modeNode.addEventListener('widget-change', ui.createHandlerFn(this, 'handleMode', this.modeWidget));
    }
    else if (!this.modeBusy && find(api.mode) != this.mode) {
      this.mode = find(api.mode);
      this.modeWidget.setValue(this.mode);
    }

    return this.modeNode;
  },

  handleControl(action) {
    return callControl(action).then((res) => {
      if (!res.result)
        ui.addNotification(null, E('p', _('Operation failed, see the logs for details.')), 'danger');

      return this.refresh();
    });
  },

  // minVersion: the oldest sing-box OpenBox supports, from status
  handleCoreInstall(minVersion) {
    ui.showModal(_('Install sing-box'), [
      E('p', { 'class': 'spinning' }, _('Checking the latest release…'))
    ]);

    return callCoreLatest().then((latest) => {
      const github = latest.error
        ? E('span', { 'class': 'cbi-value-description' }, latest.error)
        : E('span', { 'class': 'cbi-value-description' },
          _('sing-box %s for %s, %1024.2mB download.').format(latest.version, latest.arch, latest.size));

      ui.showModal(_('Install sing-box'), [
        E('label', { 'style': 'display:block;margin:.5em 0' }, [
          E('input', { 'type': 'radio', 'name': 'openbox-core', 'value': 'github',
            'checked': latest.error ? null : '', 'disabled': latest.error ? '' : null }),
          ' ', E('strong', {}, _('Latest release from GitHub')), E('br'), github
        ]),
        E('label', { 'style': 'display:block;margin:.5em 0' }, [
          E('input', { 'type': 'radio', 'name': 'openbox-core', 'value': 'upload',
            'checked': latest.error ? '' : null }),
          ' ', E('strong', {}, _('Upload an apk package')), E('br'),
          E('span', { 'class': 'cbi-value-description' },
            _('The sing-box_*_openwrt_%s.apk file from the sing-box release page.').format(latest.arch ?? '…'))
        ]),
        E('p', { 'class': 'cbi-value-description' }, [
          _('sing-box %s or later is required. The official build takes about 90 MB of storage.').format(minVersion.replace(/\.0$/, '')),
          latest.free_space != null ? ' ' + _('Free space: %1024.2mB.').format(latest.free_space) : ''
        ]),
        E('div', { 'class': 'right' }, [
          E('button', { 'class': 'cbi-button', 'click': ui.hideModal }, _('Cancel')), ' ',
          E('button', {
            'class': 'cbi-button cbi-button-positive',
            'click': ui.createHandlerFn(this, () => {
              const source = document.querySelector('input[name="openbox-core"]:checked')?.value;

              if (source == 'upload')
                return ui.uploadFile(CORE_UPLOAD)
                  .then(() => this.startCoreInstall('upload'), () => ui.hideModal());

              return this.startCoreInstall('github');
            })
          }, _('Continue'))
        ])
      ]);
    });
  },

  startCoreInstall(source) {
    return callCoreInstall(source).then((res) => {
      if (!res.result) {
        ui.addNotification(null, E('p', _('Unable to start the installation.')), 'danger');
        return ui.hideModal();
      }

      const output = E('pre', { 'style': 'max-height:20em;overflow:auto;white-space:pre-wrap' }, '');
      const close = E('button', { 'class': 'cbi-button', 'disabled': '', 'click': ui.hideModal }, _('Close'));

      ui.showModal(_('Installing sing-box'), [
        output,
        E('div', { 'class': 'right' }, [ close ])
      ]);

      const check = () => callCoreInstallStatus().then((st) => {
        output.textContent = st.log;
        output.scrollTop = output.scrollHeight;

        if (st.running)
          return window.setTimeout(check, 2000);

        close.disabled = false;
        if (st.success)
          ui.addTimeLimitedNotification(null, E('p', _('sing-box installed.')), 5000, 'info');
        else
          ui.addNotification(null, E('p', _('Installation failed, see the output for details.')), 'danger');

        return this.refresh();
      });

      window.setTimeout(check, 1000);
    });
  },

  renderButtons(status) {
    const buttons = [];

    if (!status.core?.installed || !status.core.supported) {
      buttons.push(E('button', {
        'class': 'cbi-button cbi-button-positive',
        'click': ui.createHandlerFn(this, 'handleCoreInstall', status.core?.min_version ?? '')
      }, _('Install sing-box…')));

      return buttons;
    }

    // the service of the sing-box package keeps OpenBox from starting
    // until OpenBox takes it over
    if (!status.running && status.core.service_active) {
      buttons.push(E('button', {
        'class': 'cbi-button cbi-button-positive',
        'click': ui.createHandlerFn(this, 'handleControl', 'takeover')
      }, _('Take over with OpenBox')));
    }
    else if (status.running) {
      buttons.push(E('button', {
        'class': 'cbi-button',
        'click': ui.createHandlerFn(this, 'handleControl', 'reload')
      }, _('Reload')));
      buttons.push(E('button', {
        'class': 'cbi-button cbi-button-negative',
        'click': ui.createHandlerFn(this, 'handleControl', 'stop')
      }, _('Stop')));
    }
    else if (status.enabled) {
      buttons.push(E('button', {
        'class': 'cbi-button cbi-button-positive',
        'click': ui.createHandlerFn(this, 'handleControl', 'start')
      }, _('Start')));
    }
    else {
      buttons.push(E('button', {
        'class': 'cbi-button cbi-button-positive',
        'click': ui.createHandlerFn(this, 'handleControl', 'enable')
      }, _('Enable')));
    }

    buttons.push(E('button', {
      'class': 'cbi-button',
      'click': ui.createHandlerFn(this, 'handleCoreInstall', status.core?.min_version ?? '')
    }, _('Update sing-box…')));

    return buttons;
  },

  update(status) {
    this.table.replaceChildren(...renderRows(status, this.renderMode(status.clash_api)));

    // rebuild the buttons only when they change, so a click in progress is not interrupted
    const key = [ status.core?.installed, status.core?.supported, status.core?.service_active, status.running, status.enabled ].join();
    if (key != this.buttonsKey) {
      this.buttonsKey = key;
      this.buttons.replaceChildren(...this.renderButtons(status));
    }
  },

  refresh() {
    return callStatus().then((status) => this.update(status));
  },

  render(status) {
    this.table = E('table', { 'class': 'table' });
    this.buttons = E('div', { 'style': 'display:flex;gap:8px;flex-wrap:wrap;margin-top:10px' });
    this.update(status);

    poll.add(() => this.refresh(), 5);

    return E([], [
      E('style', {}, MODE_STYLE),
      ...openbox.header(),
      E('div', { 'class': 'cbi-section' }, [
        E('h3', {}, _('Running status')),
        this.table,
        this.buttons
      ])
    ]);
  },

  handleSave: null,
  handleSaveApply: null,
  handleReset: null
});
