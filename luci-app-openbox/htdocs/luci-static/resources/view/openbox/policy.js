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

const callSubscriptionNodes = rpc.declare({
  object: 'luci.openbox',
  method: 'subscription_nodes',
  expect: { nodes: [] }
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

// a toolbar under the title of a section: its add button, moved up from
// below the table, then the given items
function sectionToolbar(node, items) {
  const create = node.querySelector('.cbi-section-create');
  const add = create?.querySelector('.cbi-button-add');
  const toolbar = E('div', { 'class': 'openbox-toolbar' }, [add, ...items].filter((item) => item));
  const title = node.querySelector('h3');

  create?.remove();
  if (title)
    title.after(toolbar);
  else
    node.prepend(toolbar);
}

const GROUP_TYPES = {
  selector: _('Manual selection'),
  urltest: _('Auto by latency')
};

return view.extend({
  load() {
    return Promise.all([
      callOutbounds(),
      // a profile from a subscription takes its nodes from it
      openbox.loadProfile().then(() => openbox.isSubscription() ? callSubscriptionNodes() : null)
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

  // the current outbound of a group, which opens the menu of the group
  renderNow(tag, group) {
    // a group sing-box does not run yet comes with the next apply
    if (!group) {
      if (this.runtime.available)
        return E('em', {}, _('Takes effect after Save & Apply'));

      return E('em', {}, (this.runtime.reason == 'not_running') ? _('Not running') : '-');
    }

    return E('button', {
      'type': 'button',
      'class': 'btn cbi-button openbox-now',
      'aria-haspopup': 'menu',
      'click': (ev) => this.toggleMenu(tag, ev.currentTarget)
    }, [
      E('span', { 'class': 'openbox-now-name' }, '%h'.format(group.now)),
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
        E('span', { 'class': 'openbox-menu-name' }, '%h'.format(name)),
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
    const tag = openbox.label(uci.get(openbox.profileConfig(), section_id) ?? {});
    const group = this.runtime.groups?.[tag];
    const key = JSON.stringify([tag, group, this.testing[tag], group && this.delayState(group.now), this.runtime.available, this.runtime.reason]);

    if (key != cell.key) {
      cell.key = key;
      dom.content(cell.node, this.renderNow(tag, group));
    }
  },

  // the delay of a node, measured by the tests of any group
  updateDelayCell(section_id) {
    const cell = this.delayCells[section_id];
    const tag = cell.tag ?? openbox.label(uci.get(openbox.profileConfig(), section_id) ?? {});
    const testing = this.testing[this.globalTag()];
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

    if (this.testAll)
      this.testAll.disabled = !this.runtime.groups?.[this.globalTag()] || !!this.testing[this.globalTag()];

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

        sectionToolbar(node, []);

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
    // any outbound except the group itself, the nodes of a subscription by
    // their tags: the nodes, then Direct, then the groups
    o.load = function (section_id) {
      this.keylist = [];
      this.vallist = [];
      openbox.outboundChoices(this, section_id);
      view.subscriptionNodes.filter((node) => node.type != 'shadowtls')
        .forEach((node) => this.value(node.tag, node.tag));

      const rank = (value) => isGroup(value) ? 2 : ((uci.get(config, value, 'type') == 'direct') ? 1 : 0);
      const choices = this.keylist.map((value, i) => [value, this.vallist[i]])
        .sort((a, b) => rank(a[0]) - rank(b[0]));
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
  // groups that contain it; a hidden one then takes all nodes, Direct and
  // the groups not hidden; as [ value, label ], one per tag. Those of a
  // subscription are named by their tags
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
      else if (!member && this.subscriptionNodes.some((node) => node.tag == ref))
        listed.push([ref, ref]);
    }

    // a hidden group, as the one of the global mode, takes everything else
    if (get('hidden') == '1') {
      for (const proxy of proxies.filter((section) => section.type != 'shadowtls'))
        ((proxy.type == 'direct') ? direct : nodes).push([proxy['.name'], openbox.label(proxy)]);
      for (const node of this.subscriptionNodes.filter((node) => node.type != 'shadowtls'))
        ((node.type == 'direct') ? direct : nodes).push([node.tag, node.tag]);
      for (const group of groups.filter((group) => group['.name'] != section_id && group.hidden != '1'))
        members.push([group['.name'], openbox.label(group)]);
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
    const s = m.section(form.GridSection, 'outbound', _('Nodes'));
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
    s.modaltitle = (section_id) => _('Nodes') + ' » ' + (uci.get(openbox.profileConfig(), section_id, 'tag') || _('New node'));

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

  // the latency test of all nodes, which tests the Global group, and the
  // count of the nodes
  testAllItems(count) {
    this.testAll = E('button', {
      'type': 'button',
      'class': 'btn cbi-button',
      'click': () => this.handleTest(this.globalTag())
    }, _('Latency test'));

    return [this.testAll, E('span', { 'class': 'openbox-toolbar-end' }, _('%d in total').format(count))];
  },

  // the nodes of a profile from a subscription: they follow the
  // subscription, so they are only listed, and their latency tested
  renderSubscriptionNodes(nodes) {
    const rows = nodes.map((node) => {
      const id = 'subscription:' + node.tag;
      this.delayCells[id] = { node: E('div'), tag: node.tag };
      this.updateDelayCell(id);

      return E('tr', { 'class': 'tr' }, [
        E('td', { 'class': 'td' }, '%h'.format(node.tag)),
        E('td', { 'class': 'td' }, NODE_TYPES[node.type] ?? '%h'.format(node.type)),
        E('td', { 'class': 'td' }, node.server ? '%h'.format(node.server_port ? `${node.server}:${node.server_port}` : node.server) : '-'),
        E('td', { 'class': 'td' }, this.delayCells[id].node)
      ]);
    });

    const toolbar = E('div', { 'class': 'openbox-toolbar' }, this.testAllItems(nodes.length));
    this.updateCells();

    return E('div', { 'class': 'cbi-section' }, [
      E('h3', {}, _('Nodes')),
      E('div', { 'class': 'cbi-section-descr' }, _('The nodes follow the subscription of this profile; only their latency is tested here.')),
      toolbar,
      E('table', { 'class': 'table' }, [
        E('tr', { 'class': 'tr table-titles' }, [
          E('th', { 'class': 'th' }, _('Name')),
          E('th', { 'class': 'th' }, _('Protocol')),
          E('th', { 'class': 'th' }, _('Server')),
          E('th', { 'class': 'th' }, _('Latency'))
        ]),
        ...rows
      ])
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

    // the nodes of a subscription, members of groups like the others
    this.subscriptionNodes = data[1] ?? [];

    const m = new form.Map(openbox.profileConfig());

    this.renderGroups(m);
    // the nodes of a subscription, listed apart; null for a local profile
    const nodes = data[1];
    if (!nodes)
      this.renderNodes(m);

    return m.render().then((mapEl) => {
      poll.add(() => this.refresh(), 5);

      return E([], [E('style', {}, STYLE), ...openbox.header(), mapEl,
      nodes ? this.renderSubscriptionNodes(nodes) : '']);
    });
  }
});
