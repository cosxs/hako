'use strict';
'require view';
'require openbox.ui as openbox';
'require form';
'require uci';

// sniffed protocols a rule can match
const PROTOCOLS = [ 'http', 'tls', 'quic', 'stun', 'dns', 'bittorrent', 'dtls', 'ssh', 'rdp', 'ntp' ];

// the condition types of a rule, by the field of a sing-box route rule. A rule
// has one, as a rule of Surge does: a list of values, or true for a flag.
// Rules with several, set by hand, are kept as they are
const TYPES = {
	domain: { hint: _('Matches the full domain.'), datatype: 'hostname', placeholder: 'www.example.com' },
	domain_suffix: { hint: _('Matches the domain and its subdomains.'), datatype: 'hostname', placeholder: 'example.com' },
	domain_keyword: { hint: _('Matches domains containing the keyword.'), placeholder: 'example' },
	domain_regex: { hint: _('Matches domains by a regular expression.'), placeholder: '^ads?\\.' },
	rule_set: { hint: _('Matches the domains and addresses of rule sets, which are added on the Rule sets tab.'), kind: 'rule_set' },
	ip_cidr: { hint: _('Matches the destination address. With FakeIP, connections to domains have a FakeIP destination; match them by domain instead.'), datatype: 'ipaddr', placeholder: '91.108.4.0/22' },
	ip_is_private: { hint: _('Matches private destination addresses.'), kind: 'flag' },
	source_ip_cidr: { hint: _('Matches the address of the LAN device.'), datatype: 'ipaddr', placeholder: '192.168.1.100' },
	source_ip_is_private: { hint: _('Matches connections from private addresses.'), kind: 'flag' },
	source_mac_address: { hint: _('Matches the MAC address of the LAN device.'), datatype: 'macaddr', placeholder: '00:11:22:33:44:55' },
	source_hostname: { hint: _('Matches the host name the LAN device has from DHCP.'), placeholder: 'iPhone' },
	port: { hint: _('Matches the destination port.'), datatype: 'port', placeholder: '443' },
	port_range: { hint: _('Matches destination ports from the first to the last.'), kind: 'range', placeholder: '1000:2000' },
	source_port: { hint: _('Matches the source port.'), datatype: 'port', placeholder: '12345' },
	source_port_range: { hint: _('Matches source ports from the first to the last.'), kind: 'range', placeholder: '1000:2000' },
	network: { hint: _('Matches the network of the connection.'), kind: 'choice', values: [ 'tcp', 'udp' ] },
	protocol: { hint: _('Matches the protocol found by sniffing.'), kind: 'choices', values: PROTOCOLS },
	inbound: { hint: _('Matches connections of the takeover or of the proxy port.'), kind: 'inbound' },
	ip_version: { hint: _('Matches IPv4 or IPv6 connections.'), kind: 'choice', values: [ '4', '6' ] },
	auth_user: { hint: _('Matches the user of the proxy port.'), placeholder: 'alice' }
};

// what a rule matches, besides the action and its comment; clash_mode is
// used by the hidden rules of the outbound modes
const MATCH_KEYS = [ ...Object.keys(TYPES), 'clash_mode' ];

// a section of the config by section name or tag, as the generator looks it up
function lookup(type, name) {
	return uci.get(openbox.profileConfig(), name) ?? uci.sections(openbox.profileConfig(), type).find((section) => section.tag == name);
}

// a ListValue whose choices are the sections of a type, stored by section name
function sectionChoices(option, type, empty) {
	if (empty)
		option.value('', empty);

	uci.sections(openbox.profileConfig(), type).forEach((section) => option.value(section['.name'], openbox.label(section)));
}

// show the label of a ListValue choice in a table instead of its value
function choiceText(section_id) {
	const value = this.cfgvalue(section_id) ?? this.default ?? '';
	const index = this.keylist.indexOf(value);

	return (index >= 0) ? this.vallist[index] : '%h'.format(value);
}

function shortList(values) {
	return (values.length > 2) ? '%s +%d'.format(values.slice(0, 2).join(', '), values.length - 2) : values.join(', ');
}

// the condition type of a rule: its one field, or "multiple" for several
function typeOf(section) {
	const keys = MATCH_KEYS.filter((key) => L.toArray(section[key]).some((value) => value !== ''));

	return (keys.length == 1) ? keys[0] : (keys.length ? 'multiple' : null);
}

function valueText(key, section) {
	const values = L.toArray(section[key]);

	if (TYPES[key]?.kind == 'flag')
		return 'true';

	if (key == 'rule_set')
		return shortList(values.map((value) => openbox.label(lookup('rule_set', value) ?? { tag: value })));

	return shortList(values);
}

const RuleSection = form.GridSection.extend({
	// a new rule goes in front of the listed ones, behind the hidden rules
	handleAdd(ev, name) {
		const first = this.cfgsections()[0];
		const result = this.super('handleAdd', [ ev, name ]);
		const added = this.map.addedSection;

		if (first && added)
			uci.move(openbox.profileConfig(), added, first);

		return result;
	}
});

return view.extend({
	load() {
		return openbox.loadProfile();
	},

	render() {
		const m = new form.Map(openbox.profileConfig());

		// the rules with the default outbound, and the rule sets they use
		const s = m.section(form.NamedSection, 'route', 'route');
		s.tab('rules', _('Rules'));
		s.tab('rule_set', _('Rule sets'));

		this.renderRules(s);
		this.renderRuleSets(s);

		return m.render().then((node) => E([], [ ...openbox.header(), node ]));
	},

	renderRules(s) {
		let o = s.taboption('rules', form.SectionValue, '_rules', RuleSection, 'route_rule', null,
			_('Rules are matched from top to bottom and the first match decides; drag a rule to change the order. Sniffing, DNS hijacking, private addresses and the Global and Direct modes are handled before these rules.'));
		const rs = o.subsection;
		rs.anonymous = true;
		rs.addremove = true;
		rs.sortable = true;
		rs.nodescriptions = true;
		rs.filter = (section_id) => !openbox.isHidden(section_id);
		rs.modaltitle = _('Route rules');

		// enabled is only written when a rule is switched off
		o = rs.option(form.Flag, 'enabled', _('Enable'));
		o.default = '1';
		o.editable = true;

		// the table: type, value, action and comment, as the rules of Surge

		o = rs.option(form.DummyValue, '_type', _('Type'));
		o.modalonly = false;
		o.textvalue = (section_id) => {
			const section = uci.get(openbox.profileConfig(), section_id) ?? {};
			const type = typeOf(section);
			const text = (type == 'multiple') ? _('Multiple conditions') : (type ?? '-');

			return (section.invert == '1') ? _('%s (inverted)').format(text) : text;
		};

		o = rs.option(form.DummyValue, '_value', _('Value'));
		o.modalonly = false;
		o.textvalue = (section_id) => {
			const section = uci.get(openbox.profileConfig(), section_id) ?? {};
			const type = typeOf(section);

			if (type != 'multiple')
				return type ? '%h'.format(valueText(type, section)) : '-';

			return E('div', {}, MATCH_KEYS.filter((key) => section[key] != null)
				.map((key) => E('div', {}, '%h: %h'.format(key, valueText(key, section)))));
		};

		o = rs.option(form.DummyValue, '_action', _('Action'));
		o.modalonly = false;
		o.textvalue = (section_id) => {
			const section = uci.get(openbox.profileConfig(), section_id) ?? {};
			const action = section.action ?? 'route';

			if (action == 'reject')
				return (section.method == 'drop') ? 'reject (drop)' : 'reject';

			if (action != 'route')
				return '%h'.format(action);

			return section.outbound ? '%h'.format(openbox.label(lookup('outbound', section.outbound) ?? { tag: section.outbound })) : E('em', {}, _('None'));
		};

		o = rs.option(form.DummyValue, '_comment', _('Comment'));
		o.modalonly = false;
		o.textvalue = (section_id) => '%h'.format(uci.get(openbox.profileConfig(), section_id, 'comment') ?? '');

		// the dialog: the rule (a type and its value), the action, and a
		// comment

		const type = rs.option(form.ListValue, '_type_choice', _('Rule type'));
		type.modalonly = true;
		type.default = 'domain_suffix';
		type.forcewrite = true;
		// the types, and for a rule of several conditions or a type set by
		// hand that one as well, for this rule only
		type.load = function(section_id) {
			const found = typeOf(uci.get(openbox.profileConfig(), section_id) ?? {});

			this.keylist = [];
			this.vallist = [];
			Object.keys(TYPES).forEach((key) => this.value(key, key));
			if (found && !(found in TYPES))
				this.value(found, (found == 'multiple') ? _('Multiple conditions') : found);

			return found;
		};
		// a rule keeps the field of its type only; flags are set here as
		// they take no value. A rule of several conditions keeps them
		type.write = type.remove = (section_id) => {
			const chosen = type.formvalue(section_id);
			if (!(chosen in TYPES))
				return;

			MATCH_KEYS.filter((key) => key != chosen).forEach((key) => uci.unset(openbox.profileConfig(), section_id, key));
			if (TYPES[chosen].kind == 'flag')
				uci.set(openbox.profileConfig(), section_id, chosen, '1');
		};

		o = rs.option(form.DummyValue, '_multiple', ' ');
		o.modalonly = true;
		o.depends('_type_choice', 'multiple');
		o.cfgvalue = () => _('This rule has several conditions, set outside this page. Its action and comment can be changed here; its conditions stay as they are.');

		// the value of each type, shown for its type; values stay while
		// another type is chosen until the rule is saved
		Object.keys(TYPES).forEach((key) => {
			const spec = TYPES[key];

			switch (spec.kind) {
			case 'flag':
				o = rs.option(form.DummyValue, '_value_' + key, _('Value'));
				o.cfgvalue = () => 'true';
				break;

			case 'rule_set':
				o = rs.option(form.MultiValue, key, _('Value'));
				// rule sets added on the other tab are listed before they are saved
				o.load = function(section_id) {
					this.keylist = [];
					this.vallist = [];
					sectionChoices(this, 'rule_set');

					return form.MultiValue.prototype.load.call(this, section_id);
				};
				break;

			case 'choice':
				o = rs.option(form.ListValue, key, _('Value'));
				spec.values.forEach((value) => o.value(value));
				break;

			case 'choices':
				o = rs.option(form.MultiValue, key, _('Value'));
				spec.values.forEach((value) => o.value(value));
				break;

			case 'inbound':
				o = rs.option(form.MultiValue, key, _('Value'));
				uci.sections('openbox', 'inbound')
					.filter((section) => section.type != 'direct' && section.tag)
					.forEach((section) => o.value(section.tag));
				break;

			default:
				o = rs.option(form.DynamicList, key, _('Value'));
				o.datatype = spec.datatype;
				o.placeholder = spec.placeholder;
				if (spec.kind == 'range')
					o.validate = (section_id, value) => (!value || /^\d*:\d*$/.test(value)) ? true : _('Expecting a range such as 1000:2000');
			}

			o.description = spec.hint;
			o.modalonly = true;
			o.retain = true;
			if (spec.kind != 'flag')
				o.rmempty = false;
			o.depends('_type_choice', key);
		});

		o = rs.option(form.Flag, 'invert', _('Invert'));
		o.description = _('The rule applies when the condition does not match.');
		o.modalonly = true;

		// what a matching connection gets

		o = rs.option(form.ListValue, 'action', _('Action'));
		o.value('', 'route');
		o.value('reject', 'reject');
		o.modalonly = true;
		// keep other actions set by hand
		uci.sections(openbox.profileConfig(), 'route_rule').forEach((section) => {
			if (!openbox.isHidden(section['.name']) && section.action && !(section.action in { route: 1, reject: 1 }))
				o.value(section.action);
		});

		o = rs.option(form.ListValue, 'outbound', _('Outbound'));
		o.rmempty = false;
		o.modalonly = true;
		o.depends('action', '');
		o.depends('action', 'route');
		openbox.outboundChoices(o);
		if (uci.get(openbox.profileConfig(), 'proxy'))
			o.default = 'proxy';

		o = rs.option(form.ListValue, 'method', _('Reject with'));
		o.value('', _('default: refuse the connection'));
		o.value('drop', _('drop: drop it silently'));
		o.modalonly = true;
		o.depends('action', 'reject');

		o = rs.option(form.Value, 'comment', _('Comment'));
		o.modalonly = true;

		// where traffic no rule matched goes
		o = s.taboption('rules', form.ListValue, 'final', _('Default outbound'));
		o.description = _('Traffic that matches no rule uses this outbound.');
		openbox.outboundChoices(o);
	},

	// rule sets, used by route rules, dns rules and the takeover bypass
	renderRuleSets(s) {
		const o = s.taboption('rule_set', form.SectionValue, '_rule_sets', form.GridSection, 'rule_set', null,
			_('Lists of domains or addresses for route rules. DNS rules and the takeover bypass use them as well.'));
		const rs = o.subsection;
		// added with a dialog, without a section name to type first
		rs.anonymous = true;
		rs.addremove = true;
		rs.nodescriptions = true;
		rs.modaltitle = (section_id) => _('Rule sets') + ' » ' + (uci.get(openbox.profileConfig(), section_id, 'tag') || _('New rule set'));

		let so = rs.option(form.Value, 'tag', _('Tag'));
		so.rmempty = false;

		so = rs.option(form.ListValue, 'type', _('Type'));
		so.value('remote', _('Remote'));
		so.value('local', _('Local file'));
		so.value('inline', _('Inline'));
		so.default = 'remote';
		so.textvalue = choiceText;

		// sing-box tells the format by the extension, .srs or .json
		so = rs.option(form.ListValue, 'format', _('Format'));
		so.value('', _('By the extension'));
		so.value('binary', _('Binary (.srs)'));
		so.value('source', _('Source (.json)'));
		so.textvalue = function(section_id) {
			return (uci.get(openbox.profileConfig(), section_id, 'type') == 'inline') ? '-' : choiceText.call(this, section_id);
		};
		so.depends('type', 'remote');
		so.depends('type', 'local');

		so = rs.option(form.Value, 'url', _('URL'));
		// LuCI has no datatype for URLs
		so.validate = (section_id, value) => (!value || /^https?:\/\/\S+$/.test(value)) ? true : _('Expecting an HTTP or HTTPS URL');
		so.rmempty = false;
		so.modalonly = true;
		so.depends('type', 'remote');

		so = rs.option(form.Value, 'path', _('Path'));
		so.rmempty = false;
		so.modalonly = true;
		so.depends('type', 'local');

		so = rs.option(form.Value, 'initial_path', _('Initial file'));
		so.description = _('A local file used at start while the rule set has not been downloaded yet.');
		so.placeholder = '/usr/share/openbox/rule-set/example.srs';
		so.modalonly = true;
		so.depends('type', 'remote');

		// the headless rules of an inline rule set, as sing-box takes them
		so = rs.option(form.TextValue, 'rules', _('Rules'));
		so.description = _('An array of <a href="%s" target="_blank" rel="noreferrer">headless rules</a> of sing-box.')
			.format('https://sing-box.sagernet.org/configuration/rule-set/headless-rule/');
		so.rows = 10;
		so.monospace = true;
		so.wrap = 'off';
		so.placeholder = JSON.stringify([ { domain_suffix: [ 'example.com' ] }, { ip_cidr: [ '203.0.113.0/24' ] } ], null, 2);
		so.rmempty = false;
		so.modalonly = true;
		so.depends('type', 'inline');
		so.validate = (section_id, value) => {
			if (!value?.trim())
				return true;

			try {
				const rules = JSON.parse(value);
				return (Array.isArray(rules) ? rules : [ rules ]).every((rule) => L.isObject(rule)) ? true : _('Expecting an array of rules');
			}
			catch (e) {
				return _('Invalid JSON: %s').format(e.message);
			}
		};

		so = rs.option(form.ListValue, 'http_client', _('Download via'));
		sectionChoices(so, 'http_client', _('Default'));
		so.modalonly = true;
		so.depends('type', 'remote');

		so = rs.option(form.Value, 'update_interval', _('Update interval'));
		openbox.duration(so, 'h', _('hours'));
		so.placeholder = '24';
		so.modalonly = true;
		so.depends('type', 'remote');
	}
});
