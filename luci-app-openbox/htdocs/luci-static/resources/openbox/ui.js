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
	[ 'logs', _('Logs') ]
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

	// the settings of a page that are only used while OpenBox generates the
	// config; the page loads the openbox config first
	profileNotice() {
		if (uci.get('openbox', 'main', 'source') != 'profile')
			return '';

		return E('div', { 'class': 'alert-message warning' },
			_('The profile %s is in use. These settings take effect after switching to the generated config on the Profiles page.').format(uci.get('openbox', 'main', 'profile')));
	},

	// the name of a section as the generator tags it
	label(section) {
		return section.tag || section['.name'];
	},

	// sections with hidden set, like the outbounds Global and Direct or the
	// rules kept in front of the listed ones, are not listed
	isHidden(section_id) {
		return uci.get('openbox', section_id, 'hidden') == '1';
	},

	// the outbounds to choose from, stored by section name: groups first,
	// then nodes and direct outbounds; except leaves one out
	outboundChoices(option, except) {
		const sections = uci.sections('openbox', 'outbound').filter((section) => section['.name'] != except);
		const isGroup = (section) => section.type == 'selector' || section.type == 'urltest';

		sections.filter(isGroup).forEach((section) => option.value(section['.name'], this.label(section)));
		sections.filter((section) => !isGroup(section)).forEach((section) => option.value(section['.name'], this.label(section)));
	},

	// dns servers that resolve real addresses: all but FakeIP
	resolverChoices(option, empty) {
		if (empty)
			option.value('', empty);

		uci.sections('openbox', 'dns_server')
			.filter((section) => section.type != 'fakeip')
			.forEach((section) => option.value(section['.name'], this.label(section)));
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
