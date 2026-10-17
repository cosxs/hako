'use strict';
'require baseclass';

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
