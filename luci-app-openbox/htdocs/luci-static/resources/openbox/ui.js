'use strict';
'require baseclass';
'require uci';

// The pages of OpenBox in the order of their tabs. Their menu entries have no
// title, so themes draw no tabs for them; every page draws these below the
// title of OpenBox instead, the way the system page has its tabs below its
// title.
const PAGES = [
  [ 'activity', _('Activity') ],
  [ 'takeover', _('Takeover') ],
  [ 'policy', _('Policies') ],
  [ 'rules', _('Route rules') ],
  [ 'core', _('Core settings') ],
  [ 'profiles', _('Profiles') ],
  [ 'logs', _('Logs') ],
  [ 'settings', _('Plugin settings') ]
];

// sing-box durations ("3m", "1h30m", "1d"): milliseconds per unit
const DURATION_UNITS = { ns: 1e-6, us: 1e-3, 'µs': 1e-3, ms: 1, s: 1e3, m: 6e4, h: 36e5, d: 864e5 };

function durationMs(value) {
  const text = String(value ?? '');
  const parts = text.match(/\d+(\.\d+)?(ns|us|µs|ms|s|m|h|d)/g);
  if (!parts || parts.join('') != text)
    return null;

  return parts.reduce((sum, part) => {
    const m = part.match(/^([\d.]+)(.+)$/);
    return sum + (+m[1]) * DURATION_UNITS[m[2]];
  }, 0);
}

return baseclass.extend({
  // the outbound modes sing-box offers by default, by their lowercase names
  modeNames: {
    rule: _('Rule-based'),
    global: _('Global proxy'),
    direct: _('Direct connection')
  },

  // the title and description of OpenBox and the tabs of its pages, for
  // the top of every page; the parent menu entry opens the first page
  header() {
    const current = L.env.dispatchpath?.[3] ?? PAGES[0][0];
    const page = PAGES.find((page) => page[0] == current);

    // without a menu title the window title would name no page
    if (page)
      document.title = '%s | %s'.format(document.title.split(' | ')[0], page[1]);

    return [
      E('h2', {}, _('OpenBox')),
      E('div', { 'class': 'cbi-map-descr' }, _('A minimal sing-box client for OpenWrt.')),
      E('ul', { 'class': 'cbi-tabmenu' }, PAGES.map((page) =>
        E('li', { 'class': (page[0] == current) ? 'cbi-tab' : 'cbi-tab-disabled' },
          E('a', { 'href': L.url('admin/services/openbox', page[0]) }, page[1]))))
    ];
  },

  // the name of the profile in use
  profileName() {
    return uci.get('openbox', 'main', 'profile') || 'default';
  },

  // the UCI package of the profile in use, where the nodes, groups, rules
  // and DNS live; the settings of the device stay in openbox, which the
  // page loads first
  profileConfig() {
    return 'openbox_' + this.profileName();
  },

  // loads the device settings and then the profile in use
  loadProfile() {
    return uci.load('openbox').then(() => uci.load(this.profileConfig()));
  },

  // whether the nodes of the profile in use come from a subscription
  isSubscription() {
    return !!uci.get(this.profileConfig(), 'profile', 'url');
  },

  // the name of a section as the generator tags it
  label(section) {
    return section.tag || section['.name'];
  },

  // sections with hidden set, like the outbounds Global and Direct or the
  // rules kept in front of the listed ones, are not listed
  isHidden(section_id) {
    return uci.get(this.profileConfig(), section_id, 'hidden') == '1';
  },

  // a section of the profile by section name or by tag, as the generator
  // looks one up
  lookup(type, name) {
    return uci.get(this.profileConfig(), name) ?? uci.sections(this.profileConfig(), type).find((section) => section.tag == name);
  },

  // the sections of a type to choose from, stored by section name; empty
  // labels a choice of none, and filter keeps some of them
  sectionChoices(option, type, empty, filter = () => true) {
    if (empty)
      option.value('', empty);

    uci.sections(this.profileConfig(), type).filter(filter)
      .forEach((section) => option.value(section['.name'], this.label(section)));
  },

  // the outbounds to choose from, stored by section name: groups first,
  // then nodes and direct outbounds; except leaves one out
  outboundChoices(option, except) {
    const isGroup = (section) => section.type == 'selector' || section.type == 'urltest';
    // a hidden group, as Global, is the one of a mode, not to be chosen;
    // the hidden Direct is
    const sections = uci.sections(this.profileConfig(), 'outbound')
      .filter((section) => section['.name'] != except && !(isGroup(section) && section.hidden == '1'));

    sections.filter(isGroup).forEach((section) => option.value(section['.name'], this.label(section)));
    sections.filter((section) => !isGroup(section)).forEach((section) => option.value(section['.name'], this.label(section)));
  },

  // dns servers that resolve real addresses: all but FakeIP
  resolverChoices(option, empty) {
    this.sectionChoices(option, 'dns_server', empty, (section) => section.type != 'fakeip');
  },

  // a fixed unit after the input field of an option
  suffix(option, text) {
    const renderWidget = option.renderWidget;

    option.renderWidget = function(...args) {
      return E('div', { 'style': 'display:flex;align-items:center;gap:6px' }, [
        renderWidget.apply(this, args),
        E('span', {}, text)
      ]);
    };
  },

  // headers as "Name: value" items
  validateHeader(section_id, value) {
    return (!value || /^[^:]*[^:\s][^:]*:/.test(value)) ? true : _('Expecting Name: value');
  },

  // a size such as 6MB or 64 MB, or a number of bytes
  validateSize(section_id, value) {
    return (!value || /^[0-9]+( ?[KMGT]?B)?$/.test(value)) ? true : _('Expecting a size such as 6MB');
  },

  // a sing-box duration entered as a whole number of one unit: "3" is kept
  // as "3m"; any other duration sing-box takes, like "90s", is kept and
  // shown as it is
  duration(option, unit, text) {
    const scale = DURATION_UNITS[unit];
    const cfgvalue = option.cfgvalue;
    const write = option.write;

    // called with the loaded value as well, which the section stores
    option.cfgvalue = function(...args) {
      const value = cfgvalue.apply(this, args);
      const ms = durationMs(value);

      return (ms != null && ms % scale == 0) ? String(ms / scale) : value;
    };
    option.write = function(section_id, value) {
      return write.call(this, section_id, /^\d+$/.test(value) ? value + unit : value);
    };
    option.validate = (section_id, value) =>
      (value == '' || /^\d+$/.test(value) || durationMs(value) != null) ? true : _('Expecting a whole number');

    this.suffix(option, text);
  }
});
