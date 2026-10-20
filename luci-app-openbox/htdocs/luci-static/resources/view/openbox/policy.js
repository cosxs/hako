'use strict';
'require view';
'require openbox.ui as openbox';
'require openbox.policy.common as common';
'require openbox.policy.general as general';
'require openbox.policy.tls as tls';
'require openbox.policy.transport as transport';
'require openbox.policy.multiplex as multiplex';
'require openbox.policy.quic as quic';
'require openbox.policy.dial as dial';
'require form';
'require uci';
'require rpc';
'require poll';
'require ui';
'require dom';


const { NODE_TYPES, validateTag } = common;

const callOutbounds = rpc.declare({
  object: 'luci.openbox',
  method: 'outbounds',
  expect: { '': {} }
});

const callSelect = rpc.declare({
  object: 'luci.openbox',
  method: 'select',
  params: ['group', 'outbound'],
  expect: { '': {} }
});

const callSubscriptions = rpc.declare({
  object: 'luci.openbox',
  method: 'subscriptions',
  expect: { subscriptions: [] }
});

const callSubscriptionAdd = rpc.declare({
  object: 'luci.openbox',
  method: 'subscription_add',
  params: [ 'title', 'type', 'prefix', 'url', 'update_interval', 'user_agent' ],
  expect: { '': {} }
});

const callSubscriptionEdit = rpc.declare({
  object: 'luci.openbox',
  method: 'subscription_edit',
  params: [ 'name', 'title', 'type', 'prefix', 'url', 'update_interval', 'user_agent' ],
  expect: { '': {} }
});

const callSubscriptionDelete = rpc.declare({
  object: 'luci.openbox',
  method: 'subscription_delete',
  params: [ 'name' ],
  expect: { '': {} }
});

const callSubscriptionUpdate = rpc.declare({
  object: 'luci.openbox',
  method: 'subscription_update',
  params: [ 'name' ],
  expect: { '': {} }
});

const callDelay = rpc.declare({
  object: 'luci.openbox',
  method: 'delay',
  params: ['group'],
  expect: { '': {} }
});

// the toolbar under the title of a section, and the menu of a group: its
// members with their delays, like the one of Surge
const STYLE = `
.openbox-toolbar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; }
.openbox-toolbar-end { margin-left: auto; }
.openbox-now { display: inline-flex; align-items: center; gap: 6px; max-width: 100%; }
.openbox-now-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.openbox-menu { position: fixed; z-index: 2000; box-sizing: border-box; min-width: 220px; max-width: min(360px, calc(100vw - 16px)); max-height: 60vh; overflow: auto; padding: 4px; border: 1px solid var(--border-color-medium, #ccc); border-radius: 8px; background: var(--background-color-high, #fff); color: var(--text-color-high, #222); box-shadow: 0 8px 24px rgba(0, 0, 0, .18); font-size: 13px; }
.openbox-menu-item { display: flex; align-items: center; gap: 8px; box-sizing: border-box; width: 100%; height: auto; min-height: 0; margin: 0; padding: 6px 10px; border: 0; border-radius: 5px; background: none; box-shadow: none; color: inherit; font: inherit; line-height: 1.4; text-align: left; cursor: pointer; }
div.openbox-menu-item { cursor: default; }
button.openbox-menu-item:hover:not([disabled]), button.openbox-menu-item:focus-visible { background: var(--primary-color-high, #1f6fd1); color: #fff; outline: none; }
.openbox-menu-item[disabled] { cursor: default; opacity: .6; }
.openbox-menu-sep { height: 1px; margin: 4px 6px; background: var(--border-color-medium, #ddd); }
.openbox-menu-check { flex: none; width: 1em; text-align: center; }
.openbox-menu-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* one width for every state, so a test does not move the tables */
.openbox-delay { display: inline-block; flex: none; box-sizing: border-box; min-width: 68px; padding: 1px 6px; border-radius: 4px; color: #fff; font-size: 12px; font-variant-numeric: tabular-nums; line-height: 1.5; text-align: center; white-space: nowrap; }
.openbox-delay.good { background: #188038; }
.openbox-delay.fair { background: #b06000; }
.openbox-delay.bad { background: #c5221f; }
.openbox-delay.pending, .openbox-delay.none { background: none; color: inherit; opacity: .5; }
`;

// a toolbar of the given items under the title of a section
function sectionToolbar(node, items) {
  const toolbar = E('div', { 'class': 'openbox-toolbar' }, items);
  const title = node.querySelector('h3');

  if (title)
    title.after(toolbar);
  else
    node.prepend(toolbar);
}

const GROUP_TYPES = {
  selector: _('Manual selection'),
  urltest: _('Auto by latency')
};

const ERRORS = {
  invalid_title: _('Expecting a name.'),
  exists: _('A subscription or an outbound with this name exists.'),
  prefix_exists: _('Another subscription names its nodes with this prefix.'),
  invalid_prefix: _('Invalid prefix.'),
  invalid_type: _('Invalid type.'),
  not_found: _('The subscription does not exist.'),
  invalid_url: _('Expecting an http:// or https:// URL.'),
  invalid_interval: _('Invalid update interval.'),
  invalid_user_agent: _('Invalid User-Agent.'),
  download_failed: _('Download failed.'),
  invalid_json: _('The download is not a JSON config.'),
  check_failed: _('sing-box check failed.'),
  busy: _('Another update is running; try again later.'),
  write_failed: _('Unable to write the subscription.'),
  update_failed: _('Update failed.')
};

function errorText(res) {
  return ERRORS[res?.error] ?? res?.error ?? _('Unknown error');
}

function button(title, handler, style) {
  return E('button', {
    'type': 'button',
    'class': 'btn cbi-button cbi-button-%s'.format(style ?? 'neutral'),
    'click': handler
  }, title);
}

// when a subscription was last updated, as a time ago
function ago(time) {
  const seconds = Math.max(0, Date.now() / 1000 - time);

  if (seconds < 60)
    return _('just now');
  if (seconds < 3600)
    return _('%d minutes ago').format(Math.floor(seconds / 60));
  if (seconds < 86400)
    return _('%d hours ago').format(Math.floor(seconds / 3600));

  return _('%d days ago').format(Math.floor(seconds / 86400));
}

// the filter of the nodes a group includes, any case; null for one that is
// no regex
function nodeFilter(value) {
  try {
    return new RegExp(value || '', 'i');
  }
  catch (e) {
    return null;
  }
}

// an update interval as hours, as the dialog takes it; another duration is
// shown as it is
function intervalHours(interval) {
  const m = /^(\d+)h$/.exec(interval ?? '');
  return m ? m[1] : (interval ?? '');
}

return view.extend({
  load() {
    return Promise.all([
      callOutbounds(),
      openbox.loadProfile().then(() => callSubscriptions())
    ]);
  },

  handleSelect(group, outbound) {
    this.closeMenu();

    return callSelect(group, outbound).then((res) => {
      if (!res.result)
        ui.addNotification(null, E('p', _('Unable to switch the outbound of %s.').format('%h'.format(group))), 'danger');

      return this.refresh();
    });
  },

  // tests all members of a group at once; those that do not answer in
  // time are shown as timed out until they answer again
  handleTest(group) {
    if (this.testing[group])
      return;

    this.testing[group] = true;
    this.updateCells();

    return callDelay(group).then((res) => {
      if (!res.result)
        throw res.error;

      for (const name of this.runtime.groups?.[group]?.all ?? []) {
        if (res.delays?.[name] > 0)
          this.failed.delete(name);
        else
          this.failed.add(name);
      }
    }).catch(() => {
      ui.addNotification(null, E('p', _('Unable to test the latency of %s.').format('%h'.format(group))), 'danger');
    }).then(() => {
      delete this.testing[group];

      return this.refresh();
    });
  },

  // the latest delay sing-box measured; a group without one of its own
  // has the one of its current outbound
  delayOf(name) {
    for (let depth = 0; depth < 8; depth++) {
      const delay = this.runtime.delays?.[name];
      if (delay > 0)
        return delay;

      const group = this.runtime.groups?.[name];
      if (!group)
        break;

      name = group.now;
    }

    return null;
  },

  // the group the Global mode sends everything to: the outbound of its
  // route rule, listed first among the groups in that mode only
  globalGroup() {
    const rule = uci.sections(openbox.profileConfig(), 'route_rule').find((rule) => rule.clash_mode?.toLowerCase() == 'global');
    const ref = rule?.outbound;
    if (!ref)
      return null;

    const sections = uci.sections(openbox.profileConfig(), 'outbound');

    return (sections.find((section) => section['.name'] == ref) ?? sections.find((section) => section.tag == ref))?.['.name'] ?? null;
  },

  // the delay to show for an outbound: its measured delay, 0 when it did
  // not answer the last test of a group, null when it was never measured
  delayState(name) {
    return this.delayOf(name) ?? (this.failed.has(name) ? 0 : null);
  },

  // a delay badge, colored like the ones of Surge; blank but as wide when
  // unmeasured
  renderDelay(name, testing) {
    const delay = this.delayState(name);

    if (testing)
      return E('span', { 'class': 'openbox-delay pending' }, '…');

    if (delay == null)
      return E('span', { 'class': 'openbox-delay none' });

    if (delay == 0)
      return E('span', { 'class': 'openbox-delay bad' }, _('Timeout'));

    const level = (delay < 300) ? 'good' : (delay < 800) ? 'fair' : 'bad';

    return E('span', { 'class': 'openbox-delay ' + level }, '%d ms'.format(delay));
  },

  // a member of a group as the group shows it: a node of a subscription
  // without the prefix it has for being one, in the group of the
  // subscription
  shortName(tag, name) {
    const sub = this.subscriptions.find((sub) => sub.tag == tag);
    const prefix = sub ? (sub.prefix || sub.tag) + ' · ' : null;

    return (prefix && name?.startsWith(prefix)) ? name.slice(prefix.length) : name;
  },

  // the current outbound of a group, which opens the menu of the group
  renderNow(tag, group, subscription) {
    // a group sing-box does not run yet comes with the next apply; that of
    // a subscription comes at once, when it has nodes
    if (!group) {
      if (this.runtime.available && !subscription)
        return E('em', {}, _('Takes effect after Save & Apply'));

      return E('em', {}, (this.runtime.reason == 'not_running') ? _('Not running') : '-');
    }

    return E('button', {
      'type': 'button',
      'class': 'btn cbi-button openbox-now',
      'aria-haspopup': 'menu',
      'click': (ev) => this.toggleMenu(tag, ev.currentTarget)
    }, [
      E('span', { 'class': 'openbox-now-name' }, '%h'.format(this.shortName(tag, group.now))),
      this.renderDelay(group.now, this.testing[tag]),
      E('span', { 'aria-hidden': 'true' }, '▾')
    ]);
  },

  // the members of a group with their delays and a latency test; the
  // members of a manual group are picked here, an auto group picks itself
  renderMenu() {
    const tag = this.menu.tag;
    const group = this.runtime.groups?.[tag];
    if (!group)
      return this.closeMenu();

    const testing = this.testing[tag];
    const selectable = group.type == 'selector';

    // left alone while nothing changed, so a click is never lost to a poll
    const key = JSON.stringify([group, testing, group.all.map((name) => this.delayState(name))]);
    if (key == this.menu.key)
      return;

    this.menu.key = key;
    dom.content(this.menu.node, [
      E('button', {
        'type': 'button',
        'class': 'openbox-menu-item',
        'disabled': testing ? '' : null,
        'click': () => this.handleTest(tag)
      }, [
        E('span', { 'class': 'openbox-menu-check' }),
        E('span', { 'class': 'openbox-menu-name' }, testing ? _('Testing…') : _('Latency test'))
      ]),
      E('div', { 'class': 'openbox-menu-sep' }),
      ...group.all.map((name) => E(selectable ? 'button' : 'div', {
        'type': selectable ? 'button' : null,
        'class': 'openbox-menu-item',
        'role': selectable ? 'menuitemradio' : null,
        'aria-checked': selectable ? String(name == group.now) : null,
        'click': selectable ? () => this.handleSelect(tag, name) : null
      }, [
        E('span', { 'class': 'openbox-menu-check' }, (name == group.now) ? '✓' : ''),
        E('span', { 'class': 'openbox-menu-name' }, '%h'.format(this.shortName(tag, name))),
        this.renderDelay(name, testing)
      ]))
    ]);
  },

  // below the current outbound, or above it when there is no room below
  placeMenu() {
    const node = this.menu.node;
    const rect = this.menu.anchor.getBoundingClientRect();
    const height = node.offsetHeight, width = node.offsetWidth;

    let top = rect.bottom + 4;
    if (top + height > window.innerHeight - 8)
      top = Math.max(8, rect.top - height - 4);

    node.style.top = top + 'px';
    node.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)) + 'px';
  },

  toggleMenu(tag, anchor) {
    const same = this.menu?.tag == tag;

    this.closeMenu();
    if (same)
      return;

    const node = E('div', { 'class': 'openbox-menu', 'role': 'menu' });
    const close = (ev) => {
      // the button of a group toggles the menu itself
      if (!node.contains(ev.target) && !ev.target.closest?.('.openbox-now'))
        this.closeMenu();
    };
    const key = (ev) => {
      if (ev.key == 'Escape')
        this.closeMenu();
    };
    const resize = () => this.closeMenu();

    this.menu = {
      tag: tag,
      anchor: anchor,
      node: node,
      release: () => {
        document.removeEventListener('mousedown', close, true);
        document.removeEventListener('scroll', close, true);
        document.removeEventListener('keydown', key, true);
        window.removeEventListener('resize', resize);
      }
    };

    document.body.appendChild(node);
    this.renderMenu();
    this.placeMenu();

    document.addEventListener('mousedown', close, true);
    document.addEventListener('scroll', close, true);
    document.addEventListener('keydown', key, true);
    window.addEventListener('resize', resize);
  },

  closeMenu() {
    if (!this.menu)
      return;

    this.menu.release();
    this.menu.node.remove();
    this.menu = null;
  },

  updateCell(section_id) {
    const cell = this.cells[section_id];
    const tag = cell.tag ?? openbox.label(uci.get(openbox.profileConfig(), section_id) ?? {});
    const group = this.runtime.groups?.[tag];
    const key = JSON.stringify([tag, group, this.testing[tag], group && this.delayState(group.now), this.runtime.available, this.runtime.reason]);

    if (key != cell.key) {
      cell.key = key;
      dom.content(cell.node, this.renderNow(tag, group, cell.tag != null));
    }
  },

  // the delay of a node, measured by the tests of any group; shown as being
  // tested while the group that tests it is, Global or its subscription
  updateDelayCell(section_id) {
    const cell = this.delayCells[section_id];
    const tag = cell.tag ?? openbox.label(uci.get(openbox.profileConfig(), section_id) ?? {});
    const testing = this.testing[cell.group ?? this.globalTag()];
    const key = JSON.stringify([tag, testing, this.delayState(tag)]);

    if (key != cell.key) {
      cell.key = key;
      dom.content(cell.node, this.renderDelay(tag, testing));
    }
  },

  updateCells() {
    for (const section_id in this.cells)
      if (this.cells[section_id].node.isConnected)
        this.updateCell(section_id);

    for (const section_id in this.delayCells)
      if (this.delayCells[section_id].node.isConnected)
        this.updateDelayCell(section_id);

    for (const { button, group } of this.testButtons)
      if (button.isConnected)
        button.disabled = !this.runtime.groups?.[group] || !!this.testing[group];

    if (this.menu)
      this.renderMenu();
  },

  refresh() {
    return callOutbounds().then((data) => {
      this.runtime = data;

      // a measured delay replaces a failed test
      for (const name of this.failed)
        if (data.delays?.[name] > 0)
          this.failed.delete(name);

      this.updateCells();
    });
  },

  // the current outbound of each group, from the running sing-box
  nowColumn(s) {
    const o = s.option(form.DummyValue, '_now', _('Current outbound'));
    o.modalonly = false;
    o.textvalue = (section_id) => {
      this.cells[section_id] = { node: E('div') };
      this.updateCell(section_id);

      return this.cells[section_id].node;
    };
  },

  renderGroups(m) {
    const s = m.section(form.GridSection, 'outbound', _('Policy groups'));
    s.anonymous = true;
    s.addremove = true;
    s.sortable = true;
    s.nodescriptions = true;
    s.filter = (section_id) => uci.get(openbox.profileConfig(), section_id, 'type') in GROUP_TYPES &&
      (!openbox.isHidden(section_id) || section_id == this.globalSection);
    s.modaltitle = (section_id) => _('Policy groups') + ' » ' + (uci.get(openbox.profileConfig(), section_id, 'tag') || _('New group'));

    // the group of the Global mode comes first, shown in that mode only,
    // and is neither edited, removed nor moved here
    const view = this;

    s.cfgsections = function () {
      const sections = form.GridSection.prototype.cfgsections.call(this);
      const index = sections.indexOf(view.globalSection);
      if (index > 0)
        sections.unshift(...sections.splice(index, 1));

      return sections;
    };

    s.renderRowActions = function (section_id) {
      const td = form.GridSection.prototype.renderRowActions.apply(this, arguments);
      if (section_id == view.globalSection)
        td.replaceChildren();

      return td;
    };

    s.render = function () {
      return Promise.resolve(form.GridSection.prototype.render.apply(this, arguments)).then((node) => {
        const row = node.querySelector('[data-sid="%s"]'.format(view.globalSection));
        if (row) {
          // nothing is dropped onto it
          for (const type of ['dragover', 'drop'])
            row.addEventListener(type, (ev) => ev.stopImmediatePropagation(), true);
          row.style.display = (view.mode?.toLowerCase() == 'global') ? '' : 'none';
        }

        return node;
      });
    };

    let o = s.option(form.Value, 'tag', _('Name'));
    o.rmempty = false;
    o.validate = validateTag;

    o = s.option(form.ListValue, 'type', _('Type'));
    Object.keys(GROUP_TYPES).forEach((type) => o.value(type, GROUP_TYPES[type]));
    o.default = 'selector';
    o.textvalue = (section_id) => GROUP_TYPES[uci.get(openbox.profileConfig(), section_id, 'type')];

    this.nowColumn(s);

    const config = openbox.profileConfig();
    const isGroup = (value) => uci.get(config, value, 'type') in GROUP_TYPES;

    // in the order they are dragged to, as in Surge
    o = s.option(form.DynamicList, 'outbounds', _('Outbound tags'));
    o.modalonly = true;
    o.onchange = function (ev, section_id) {
      view.refreshDefault(this.section, section_id);
    };
    // any outbound except the group itself: the nodes, the subscriptions,
    // each a group of its nodes, then Direct, then the groups
    o.load = function (section_id) {
      this.keylist = [];
      this.vallist = [];
      openbox.outboundChoices(this, section_id);

      const pairs = this.keylist.map((value, i) => [value, this.vallist[i]]);
      const isDirect = (value) => uci.get(config, value, 'type') == 'direct';
      const subscriptions = view.subscriptions.filter((sub) => sub.enabled)
        .map((sub) => [sub.name, _('%s (subscription)').format(sub.tag)]);
      const isSubscription = (value) => view.subscriptions.some((sub) => sub.name == value);
      const choices = [
        ...pairs.filter(([value]) => !isGroup(value) && !isDirect(value) && !isSubscription(value)),
        ...subscriptions,
        ...pairs.filter(([value]) => !isGroup(value) && isDirect(value)),
        ...pairs.filter(([value]) => isGroup(value))
      ];
      this.keylist = choices.map((choice) => choice[0]);
      this.vallist = choices.map((choice) => choice[1]);

      return form.DynamicList.prototype.load.call(this, section_id);
    };
    // a group listed that contains this one, directly or through others,
    // makes a loop, which sing-box refuses only when it starts: refused here,
    // as in Surge. LuCI checks the whole list on each change and on saving
    o.validate = function (section_id) {
      const containers = view.groupContainers(section_id);
      const sections = uci.sections(config, 'outbound');
      const loop = L.toArray(this.formvalue(section_id))
        .map((ref) => sections.find((section) => section['.name'] == ref) ?? sections.find((section) => section.tag == ref))
        .find((section) => section && containers.has(section['.name']));

      return loop ? _('Circular reference found in policy group: %s').format(openbox.label(loop)) : true;
    };

    // the nodes of subscriptions, after those listed, as Surge includes
    // other groups; a list as the outbounds are, in the order the nodes
    // come in. The filter takes some of them, by their names without the
    // prefix, any case
    o = s.option(form.DynamicList, 'include', _('Include subscription nodes'));
    o.modalonly = true;
    o.load = function (section_id) {
      this.keylist = [];
      this.vallist = [];
      view.subscriptions.filter((sub) => sub.enabled).forEach((sub) => this.value(sub.name, sub.tag));

      return form.DynamicList.prototype.load.call(this, section_id);
    };
    o.onchange = function (ev, section_id) {
      view.refreshDefault(this.section, section_id);
    };

    o = s.option(form.Value, 'filter', _('Node filter'));
    o.placeholder = 'hong kong|japan';
    o.modalonly = true;
    o.validate = (section_id, value) => (!value || nodeFilter(value)) ? true : _('Expecting a regular expression');
    o.onchange = function (ev, section_id) {
      view.refreshDefault(this.section, section_id);
    };

    // one of the members of the group, as they are when the dialog opens
    o = s.option(form.ListValue, 'default', _('Default outbound'));
    o.modalonly = true;
    o.depends('type', 'selector');
    o.load = function (section_id) {
      this.keylist = [];
      this.vallist = [];
      this.value('', _('First member'));
      view.groupMembers(section_id, (name) => uci.get(openbox.profileConfig(), section_id, name))
        .forEach(([value, label]) => this.value(value, label));

      return form.ListValue.prototype.load.call(this, section_id);
    };

    o = s.option(form.Value, 'url', _('Test URL'));
    o.placeholder = 'https://www.gstatic.com/generate_204';
    o.modalonly = true;
    o.depends('type', 'urltest');

    o = s.option(form.Value, 'interval', _('Test interval'));
    openbox.duration(o, 'm', _('minutes'));
    o.placeholder = '3';
    o.modalonly = true;
    o.depends('type', 'urltest');

    o = s.option(form.Value, 'idle_timeout', _('Idle timeout'));
    openbox.duration(o, 'm', _('minutes'));
    o.placeholder = '30';
    o.modalonly = true;
    o.depends('type', 'urltest');

    o = s.option(form.Value, 'tolerance', _('Tolerance'));
    openbox.suffix(o, _('ms'));
    o.datatype = 'uinteger';
    o.placeholder = '50';
    o.modalonly = true;
    o.depends('type', 'urltest');

    o = s.option(form.Flag, 'interrupt_exist_connections', _('Interrupt existing connections'));
    o.modalonly = true;
  },

  // the groups that contain a group, directly or through others, by section
  // name, as the generator finds them: a group contains those it lists, and
  // a hidden one every group not hidden. sing-box refuses such a loop only
  // when it starts, so the dialog refuses to save it, and the generator drops
  // a group listed that contains the one listing it
  groupContainers(section_id) {
    const groups = uci.sections(openbox.profileConfig(), 'outbound').filter((section) => section.type in GROUP_TYPES);
    const find = (ref) => groups.find((section) => section['.name'] == ref) ?? groups.find((section) => section.tag == ref);
    const refs = (group) => [
      ...L.toArray(group.outbounds).map(find).filter((member) => member && member != group),
      ...((group.hidden == '1') ? groups.filter((other) => other != group && other.hidden != '1') : [])
    ];
    const containers = new Set([section_id]);

    for (let grown = true; grown;) {
      grown = false;
      for (const group of groups.filter((group) => !containers.has(group['.name'])))
        if (refs(group).some((member) => containers.has(member['.name']))) {
          containers.add(group['.name']);
          grown = true;
        }
    }

    containers.delete(section_id);
    return containers;
  },

  // the members of a group as the generator finds them from the options of
  // the group, which get reads: those listed, in their order, but for the
  // groups that contain it, a subscription being a group of its nodes; a
  // hidden one then takes the nodes of the profile, Direct, the groups not
  // hidden and the subscriptions; as [ value, label ], one per tag. Nodes of
  // a subscription listed by hand are named by their tags
  groupMembers(section_id, get) {
    const all = uci.sections(openbox.profileConfig(), 'outbound');
    // a group just added has no type until saved
    const isGroup = (section) => section.type in GROUP_TYPES || section['.name'] == section_id;
    const groups = all.filter(isGroup);
    const proxies = all.filter((section) => !isGroup(section));
    const find = (list, ref) => list.find((section) => section['.name'] == ref) ?? list.find((section) => section.tag == ref);
    const containers = this.groupContainers(section_id);
    const listed = [], nodes = [], direct = [], members = [];

    for (const ref of L.toArray(get('outbounds'))) {
      const member = find(groups, ref) ?? find(proxies, ref);
      if (member && containers.has(member['.name']))
        continue;
      if (member && member['.name'] != section_id)
        listed.push([member['.name'], openbox.label(member)]);
      else if (member)
        continue;
      else if (this.findSubscription(ref)) {
        const sub = this.findSubscription(ref);
        if (this.isPolicy(sub))
          listed.push([sub.name, sub.tag]);
      }
      else if (this.subscriptionNodes.some((node) => node.tag == ref))
        listed.push([ref, ref]);
    }

    // then the nodes of the subscriptions it includes, by the filter
    const filter = nodeFilter(get('filter'));
    for (const ref of filter ? L.toArray(get('include')) : []) {
      const sub = this.findSubscription(ref);
      if (sub?.enabled)
        sub.usable.filter((node) => node.type != 'shadowtls' && filter.test(node.name ?? node.tag))
          .forEach((node) => listed.push([node.tag, node.tag]));
    }

    // a hidden group, as the one of the global mode, takes everything else
    if (get('hidden') == '1') {
      for (const proxy of proxies.filter((section) => section.type != 'shadowtls'))
        ((proxy.type == 'direct') ? direct : nodes).push([proxy['.name'], openbox.label(proxy)]);
      for (const group of groups.filter((group) => group['.name'] != section_id && group.hidden != '1'))
        members.push([group['.name'], openbox.label(group)]);
      for (const sub of this.subscriptions.filter((sub) => this.isPolicy(sub)))
        members.push([sub.name, sub.tag]);
    }

    return [...listed, ...nodes, ...direct, ...members]
      .filter(([, label], i, list) => list.findIndex((member) => member[1] == label) == i);
  },

  // the choices of the default outbound in the dialog of a group, from the
  // members being edited; a default no longer a member goes back to the
  // first member
  refreshDefault(section, section_id) {
    const select = section.getUIElement(section_id, 'default')?.node?.querySelector('select');
    if (!select)
      return;

    const value = select.value;
    const members = this.groupMembers(section_id, (name) => section.formvalue(section_id, name));

    select.replaceChildren(E('option', { 'value': '' }, _('First member')),
      ...members.map(([value, label]) => E('option', { 'value': value }, '%h'.format(label))));
    select.value = members.some((member) => member[0] == value) ? value : '';
  },

  // the tag of the Global group, which holds every node: testing it tests
  // them all
  globalTag() {
    return this.globalSection ? openbox.label(uci.get(openbox.profileConfig(), this.globalSection) ?? {}) : null;
  },

  renderNodes(m) {
    const s = m.section(form.GridSection, 'outbound', _('Local nodes'));
    s.anonymous = true;
    s.addremove = true;
    s.nodescriptions = true;

    // a latency test of all nodes above the table
    const view = this;

    s.render = function () {
      return Promise.resolve(form.GridSection.prototype.render.apply(this, arguments)).then((node) => {
        sectionToolbar(node, view.testAllItems(s.cfgsections().length));
        view.updateCells();

        return node;
      });
    };
    s.filter = (section_id) => !(uci.get(openbox.profileConfig(), section_id, 'type') in GROUP_TYPES) && !openbox.isHidden(section_id);
    s.modaltitle = (section_id) => _('Local nodes') + ' » ' + (uci.get(openbox.profileConfig(), section_id, 'tag') || _('New node'));

    // the dialog in tabs; a tab whose fields are all hidden by the
    // protocol is left out
    s.tab('general', _('Basic'));
    s.tab('tls', 'TLS');
    s.tab('transport', _('Transport'));
    s.tab('multiplex', _('Multiplex'));
    s.tab('quic', 'QUIC');
    s.tab('dial', _('Dial'));

    // the fields of the dialog, by tab
    for (const tab of [general, tls, transport, multiplex, quic, dial])
      tab.add(s);

    const o = s.taboption('general', form.DummyValue, '_delay', _('Latency'));
    o.modalonly = false;
    o.textvalue = (section_id) => {
      this.delayCells[section_id] = { node: E('div') };
      this.updateDelayCell(section_id);

      return this.delayCells[section_id].node;
    };
  },

  // a latency test of nodes, and their count: those of the profile with the
  // Global group, those of a subscription with the group of the
  // subscription
  testAllItems(count, group) {
    group ??= this.globalTag();

    const button = E('button', {
      'type': 'button',
      'class': 'btn cbi-button',
      'click': () => this.handleTest(group)
    }, _('Latency test'));

    this.testButtons.push({ button: button, group: group });

    return [button, E('span', { 'class': 'openbox-toolbar-end' }, _('%d in total').format(count))];
  },

  // the subscriptions of the profile, with the nodes the generator takes of
  // each: those named as no outbound of the profile and no node of a
  // subscription before; one switched off gives none
  setSubscriptions(subscriptions) {
    const taken = new Set(uci.sections(openbox.profileConfig(), 'outbound').map((section) => openbox.label(section)));

    this.subscriptions = subscriptions;
    this.subscriptionNodes = [];
    for (const sub of subscriptions) {
      sub.usable = sub.enabled ? sub.nodes.filter((node) => !taken.has(node.tag)) : [];
      sub.usable.forEach((node) => taken.add(node.tag));
      this.subscriptionNodes.push(...sub.usable);
    }
  },

  // whether a subscription is a group of its nodes, as the generator makes
  // one: switched on, with nodes
  isPolicy(sub) {
    return sub.enabled && sub.usable.some((node) => node.type != 'shadowtls');
  },

  // a subscription by section name, or else by its name
  findSubscription(ref) {
    return this.subscriptions.find((sub) => sub.name == ref) ?? this.subscriptions.find((sub) => sub.tag == ref);
  },

  refreshSubscriptions() {
    return callSubscriptions().then((subscriptions) => {
      this.setSubscriptions(subscriptions);
      this.fillSubscriptions();
    });
  },

  // when a subscription was updated, or why its last update failed
  updateText(sub) {
    if (sub.last_error)
      return E('span', { 'style': 'color:#c43c35' }, _('Last update failed: %s').format('%h'.format(sub.last_error)));

    return sub.last_update ? ago(sub.last_update) : E('em', {}, _('Not downloaded'));
  },

  // the subscriptions, one a row, each a group of its nodes with its
  // current outbound
  fillSubscriptions() {
    const rows = this.subscriptions.map((sub) => E('tr', { 'class': 'tr' }, [
      E('td', { 'class': 'td' }, '%h'.format(sub.tag)),
      E('td', { 'class': 'td' }, GROUP_TYPES[sub.type] ?? GROUP_TYPES.selector),
      E('td', { 'class': 'td' }, (() => {
        this.cells[sub.name] = { node: E('div'), tag: sub.tag };
        this.updateCell(sub.name);
        return this.cells[sub.name].node;
      })()),
      E('td', { 'class': 'td', 'style': 'max-width:0' },
        E('div', { 'title': sub.url ?? '', 'style': 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, '%h'.format(sub.url ?? ''))),
      E('td', { 'class': 'td', 'style': 'white-space:nowrap' }, sub.downloaded ? _('%d nodes').format(sub.nodes.length) : '-'),
      E('td', { 'class': 'td' }, this.updateText(sub)),
      E('td', { 'class': 'td cbi-section-actions' }, E('div', {}, [
        button(_('Details'), ui.createHandlerFn(this, 'handleDetails', sub)),
        button(_('Update'), ui.createHandlerFn(this, 'handleUpdate', sub)),
        button(_('Edit'), ui.createHandlerFn(this, 'handleSubscription', sub), 'edit'),
        button(_('Delete'), () => this.handleDelete(sub), 'remove')
      ]))
    ]));

    dom.content(this.subscriptionTable, [
      E('tr', { 'class': 'tr table-titles' }, [
        E('th', { 'class': 'th', 'style': 'width:12%' }, _('Name')),
        E('th', { 'class': 'th', 'style': 'width:10%' }, _('Type')),
        E('th', { 'class': 'th' }, _('Current outbound')),
        E('th', { 'class': 'th', 'style': 'width:20%' }, _('Subscription URL')),
        E('th', { 'class': 'th', 'style': 'width:80px;white-space:nowrap' }, _('Nodes')),
        E('th', { 'class': 'th', 'style': 'width:14%' }, _('Update')),
        E('th', { 'class': 'th cbi-section-actions' })
      ]),
      ...(rows.length ? rows : [ E('tr', { 'class': 'tr placeholder' },
        E('td', { 'class': 'td', 'colspan': 7 }, E('em', {}, _('This section contains no values yet')))) ])
    ]);
  },

  // the nodes of a subscription, only listed, with their latency
  // the dialogs of a subscription open with it as it is now: loaded anew
  // first, with the button busy meanwhile as LuCI shows its own
  withSubscription(sub, open) {
    return this.refreshSubscriptions().then(() => {
      const current = sub ? this.subscriptions.find((other) => other.name == sub.name) : null;
      if (sub && !current)
        return ui.addNotification(null, E('p', ERRORS.not_found), 'danger');

      return open(current);
    });
  },

  handleDetails(sub) {
    return this.withSubscription(sub, (sub) => this.showDetails(sub));
  },

  handleSubscription(sub) {
    return this.withSubscription(sub, (sub) => this.showSubscription(sub));
  },

  showDetails(sub) {
    const rows = sub.nodes.map((node) => {
      const id = 'subscription:' + node.tag;
      this.delayCells[id] = { node: E('div'), tag: node.tag, group: sub.tag };
      this.updateDelayCell(id);

      return E('tr', { 'class': 'tr' }, [
        E('td', { 'class': 'td' }, '%h'.format(node.tag)),
        E('td', { 'class': 'td' }, NODE_TYPES[node.type] ?? '%h'.format(node.type)),
        E('td', { 'class': 'td' }, node.server ? '%h'.format(node.server_port ? `${node.server}:${node.server_port}` : node.server) : '-'),
        E('td', { 'class': 'td' }, this.delayCells[id].node)
      ]);
    });

    ui.showModal(_('Subscription') + ' » ' + '%h'.format(sub.tag), [
      E('div', { 'class': 'openbox-toolbar' }, this.testAllItems(sub.nodes.length, sub.tag)),
      // the latency keeps its width while the delays change
      E('div', { 'style': 'max-height:60vh;overflow:auto' }, E('table', { 'class': 'table', 'style': 'table-layout:fixed' }, [
        E('tr', { 'class': 'tr table-titles' }, [
          E('th', { 'class': 'th', 'style': 'width:30%' }, _('Name')),
          E('th', { 'class': 'th', 'style': 'width:18%' }, _('Protocol')),
          E('th', { 'class': 'th' }, _('Server')),
          E('th', { 'class': 'th', 'style': 'width:96px' }, _('Latency'))
        ]),
        ...rows
      ])),
      E('div', { 'class': 'button-row' }, E('button', { 'class': 'btn cbi-button', 'click': ui.hideModal }, _('Close')))
    ], 'cbi-modal');

    this.updateCells();
  },

  handleUpdate(sub) {
    return callSubscriptionUpdate(sub.name).then((res) => {
      const title = '%h'.format(sub.tag);

      if (!res.result)
        ui.addNotification(null, [
          E('p', _('Unable to update %s').format(title) + ': ' + errorText(res)),
          res.output ? E('pre', { 'style': 'white-space:pre-wrap' }, '%h'.format(res.output)) : ''
        ], 'danger');
      else
        ui.addTimeLimitedNotification(null, E('p', !res.changed ? _('%s is up to date.').format(title)
          : res.reloaded ? _('%s updated; sing-box was reloaded.').format(title) : _('%s updated.').format(title)), 5000, 'info');

      return this.refreshSubscriptions();
    });
  },

  // a new subscription, or one changed; downloaded first when it is new or
  // has another URL or User-Agent, and not saved when that fails
  showSubscription(sub) {
    // checked as the fields of a form are, when shown and while typed: the
    // name and the prefix its nodes are named with taken by no other
    // subscription, and the name by no outbound either; a prefix left empty
    // is the name
    const others = this.subscriptions.filter((other) => other.name != sub?.name);
    const outboundTags = uci.sections(openbox.profileConfig(), 'outbound').map((section) => openbox.label(section));
    const prefixTaken = (value) => others.some((other) => (other.prefix || other.tag) == value);

    const name = new ui.Textfield(sub?.tag ?? '', {
      optional: false,
      placeholder: _('Airport A'),
      validate: (value) => {
        value = value.trim();
        if (others.some((other) => other.tag == value) || outboundTags.includes(value))
          return ERRORS.exists;
        if (!prefix.getValue().trim() && prefixTaken(value))
          return ERRORS.prefix_exists;
        return true;
      }
    });
    const prefix = new ui.Textfield(sub?.prefix ?? '', {
      placeholder: sub?.tag ?? '',
      validate: (value) => (value.trim() && prefixTaken(value.trim())) ? ERRORS.prefix_exists : true
    });
    const kind = new ui.Select(sub?.type ?? 'selector', GROUP_TYPES, {});
    const url = new ui.Textfield(sub?.url ?? '', {
      optional: false,
      placeholder: 'https://example.com/sing-box.json',
      validate: (value) => /^https?:\/\/\S+$/.test(value.trim()) ? true : ERRORS.invalid_url
    });
    const hours = new ui.Textfield(intervalHours(sub?.update_interval), {
      placeholder: '24',
      validate: (value) => /^(\d*|(\d+[smhd])+)$/.test(value.trim()) ? true : ERRORS.invalid_interval
    });
    const agent = new ui.Textfield(sub?.user_agent ?? '', { placeholder: 'sing-box/1.14 OpenBox/0.1' });
    const fields = [ name, prefix, url, hours, agent ];
    const message = E('div', { 'style': 'color:#c43c35' });
    const row = (label, widget, suffix) => E('div', { 'class': 'cbi-value' }, [
      E('label', { 'class': 'cbi-value-title' }, label),
      E('div', { 'class': 'cbi-value-field' }, suffix
        ? E('div', { 'style': 'display:flex;align-items:center;gap:6px' }, [ widget.render(), E('span', {}, suffix) ])
        : widget.render())
    ]);

    const save = () => {
      fields.forEach((field) => field.triggerValidation());
      const invalid = fields.find((field) => !field.isValid());
      if (invalid) {
        invalid.node?.querySelector('input')?.focus();
        return;
      }

      // hours are kept as a sing-box duration; none updates by hand only
      const h = hours.getValue().trim();
      const interval = /^\d+$/.test(h) ? ((+h > 0) ? h + 'h' : '') : h;
      const values = [ name.getValue().trim(), kind.getValue(), prefix.getValue().trim(), url.getValue().trim(), interval, agent.getValue().trim() ];
      const call = sub ? callSubscriptionEdit(sub.name, ...values) : callSubscriptionAdd(...values);

      return call.then((res) => {
        if (!res.result) {
          dom.content(message, [
            E('p', {}, '%h'.format(errorText(res))),
            res.output ? E('pre', { 'style': 'white-space:pre-wrap;font-size:12px' }, '%h'.format(res.output)) : ''
          ]);
          return;
        }

        return this.refreshSubscriptions().then(() => ui.hideModal());
      });
    };

    // laid out as the dialogs of the groups and nodes
    ui.showModal(_('Subscription') + ' » ' + (sub ? '%h'.format(sub.tag) : _('New subscription')), [
      E('div', { 'class': 'cbi-map' }, E('div', { 'class': 'cbi-section' }, E('div', { 'class': 'cbi-section-node' }, [
        row(_('Name'), name),
        row(_('Type'), kind),
        row(_('Node name prefix'), prefix),
        row(_('Subscription URL'), url),
        row(_('Update interval'), hours, _('hours')),
        row(_('User-Agent'), agent),
        message
      ]))),
      E('div', { 'class': 'button-row' }, [
        E('button', { 'class': 'btn cbi-button', 'click': ui.hideModal }, _('Close')),
        ' ',
        E('button', { 'class': 'btn cbi-button cbi-button-positive important', 'click': ui.createHandlerFn(this, save) },
          sub ? _('Save') : _('Download and save'))
      ])
    ], 'cbi-modal');

    // the prefix shows the name it stands for when empty, and the name is
    // checked again with it
    const nameInput = name.node.querySelector('input');
    nameInput.addEventListener('input', () => {
      prefix.node.querySelector('input').placeholder = nameInput.value.trim();
      prefix.triggerValidation();
    });
    prefix.node.querySelector('input').addEventListener('input', () => name.triggerValidation());

    fields.forEach((field) => field.triggerValidation());
    nameInput.focus();
  },

  // the groups that list a subscription no longer do: the page loads them
  // anew
  handleDelete(sub) {
    ui.showModal(_('Delete %s?').format('%h'.format(sub.tag)), [
      E('p', {}, _('The subscription and what it downloaded are deleted, and the groups that list it no longer do.')),
      E('div', { 'class': 'right', 'style': 'display:flex;gap:6px;justify-content:flex-end' }, [
        button(_('Cancel'), ui.hideModal),
        button(_('Delete'), ui.createHandlerFn(this, () => callSubscriptionDelete(sub.name).then((res) => {
          ui.hideModal();
          if (!res.result)
            return ui.addNotification(null, E('p', _('Unable to delete %s').format('%h'.format(sub.tag)) + ': ' + errorText(res)), 'danger');

          location.reload();
        })), 'negative')
      ])
    ]);
  },

  // the subscriptions of the profile, beside the nodes; they are changed at
  // once, not with the form
  renderSubscriptions() {
    this.subscriptionTable = E('table', { 'class': 'table' });
    this.fillSubscriptions();

    return E('div', { 'class': 'cbi-section' }, [
      E('h3', {}, _('Subscription nodes')),
      E('div', { 'class': 'cbi-section-descr' }, _('Subscriptions give nodes only, which follow their updates; Details lists them with their latency. Each subscription is a policy as well, which groups and rules may take. Subscriptions are added, edited, deleted and updated at once.')),
      this.subscriptionTable,
      E('div', { 'class': 'cbi-section-create' },
        button(_('Add'), ui.createHandlerFn(this, 'handleSubscription', null), 'add'))
    ]);
  },

  render(data) {
    this.runtime = data[0];
    // runtime cells of the tables by section name, refilled on every poll
    this.cells = {};
    this.delayCells = {};
    this.globalSection = this.globalGroup();
    // the groups being tested, and the outbounds that failed their last test
    this.testing = {};
    this.failed = new Set();
    // the open menu of a group
    this.menu = null;

    // the outbound mode, switched on the activity page, shows the group
    // of the Global mode; the generator falls back the same way
    this.mode = uci.get('openbox', 'main', 'mode') ?? uci.get('openbox', 'clash_api', 'default_mode');

    // the latency tests of all nodes, on the page and in a dialog
    this.testButtons = [];

    // the nodes of subscriptions, members of groups like the others
    this.setSubscriptions(data[1] ?? []);

    const m = new form.Map(openbox.profileConfig());

    this.renderGroups(m);
    this.renderNodes(m);

    return m.render().then((mapEl) => {
      poll.add(() => this.refresh(), 5);

      return E([], [E('style', {}, STYLE), ...openbox.header(), mapEl, this.renderSubscriptions()]);
    });
  }
});
