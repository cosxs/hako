'use strict';
'require baseclass';
'require form';
'require uci';
'require openbox.ui as openbox';
'require openbox.fields as fields';

// the condition of a route rule as a rule of Surge has one: a type, the field
// of a sing-box route rule, and its value. Standard rules and the rules of a
// logical rule are written with it

// sniffed protocols a rule can match
const PROTOCOLS = [ 'http', 'tls', 'quic', 'stun', 'dns', 'bittorrent', 'dtls', 'ssh', 'rdp', 'ntp' ];

// the condition types: a list of values, or true for a flag. Rules with
// several, set by hand, are kept as they are
const TYPES = {
  domain: { hint: _('Matches the full domain.'), datatype: 'hostname', placeholder: 'www.example.com' },
  domain_suffix: { hint: _('Matches the domain and its subdomains.'), datatype: 'hostname', placeholder: 'example.com' },
  domain_keyword: { hint: _('Matches domains containing the keyword.'), placeholder: 'example' },
  domain_regex: { hint: _('Matches domains by a regular expression.'), placeholder: '^ads?\\.' },
  rule_set: { hint: _('Matches the domains and addresses of rule sets, which are added below.'), kind: 'rule_set' },
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

function shortList(values) {
  return (values.length > 2) ? '%s +%d'.format(values.slice(0, 2).join(', '), values.length - 2) : values.join(', ');
}

// the label of a rule set a rule names
function ruleSetLabel(name) {
  return openbox.label(openbox.lookup('rule_set', name) ?? { tag: name });
}

// the condition type of a rule: logical, its one field, or "multiple" for
// several; a rule of a logical rule may be written as JSON
function typeOf(section) {
  if (section.type == 'logical')
    return 'logical';

  if (section.json)
    return 'json';

  const keys = MATCH_KEYS.filter((key) => L.toArray(section[key]).some((value) => value !== ''));

  return (keys.length == 1) ? keys[0] : (keys.length ? 'multiple' : null);
}

function valueText(key, section) {
  const values = L.toArray(section[key]);

  if (TYPES[key]?.kind == 'flag')
    return 'true';

  if (key == 'rule_set')
    return shortList(values.map(ruleSetLabel));

  return shortList(values);
}

// a rule as Surge shows one: (type,value,...) for a condition, (AND,(...))
// for a logical rule, and (NOT,(...)) around one inverted
function ruleExpr(rule) {
  const values = (value) => Array.isArray(value) ? value : [ value ];
  let text;

  if (rule.type == 'logical') {
    text = '(%s,(%s))'.format(String(rule.mode ?? 'and').toUpperCase(), values(rule.rules ?? []).map(ruleExpr).join(', '));
  }
  else {
    const parts = Object.keys(rule).filter((key) => key != 'type' && key != 'invert')
      .map((key) => '(%s)'.format([ key, ...values(rule[key]) ].join(',')));
    text = (parts.length == 1) ? parts[0] : '(%s)'.format(parts.join(', '));
  }

  return rule.invert ? '(NOT,(%s))'.format(text) : text;
}

// a rule of the config as a rule of sing-box, with rule sets by their label
function ruleOf(section) {
  let rule = {};

  if (section.json) {
    try {
      rule = JSON.parse(section.json);
    }
    catch (e) {}
  }
  else {
    MATCH_KEYS.filter((key) => section[key] != null).forEach((key) => {
      rule[key] = (TYPES[key]?.kind == 'flag') ? true
        : (key == 'rule_set') ? L.toArray(section[key]).map(ruleSetLabel)
        : L.toArray(section[key]);
    });
  }

  if (section.invert == '1')
    rule.invert = true;

  return rule;
}

// the type of a rule in a table
function typeText(section) {
  const type = typeOf(section);

  return (type == 'multiple') ? _('Multiple conditions')
    : (type == 'logical') ? (section.mode ?? 'and').toUpperCase()
    : (type == 'json') ? 'JSON' : (type ?? '-');
}

// the value of a rule in a table; one written as JSON as Surge shows it,
// without its inversion, which the table shows apart
function valueCell(section) {
  const type = typeOf(section);

  if (type == 'json')
    return '%h'.format(ruleExpr(ruleOf(Object.assign({}, section, { invert: null }))));

  if (type != 'multiple')
    return type ? '%h'.format(valueText(type, section)) : '-';

  return E('div', {}, MATCH_KEYS.filter((key) => section[key] != null)
    .map((key) => E('div', {}, '%h: %h'.format(key, valueText(key, section)))));
}

// the options of a condition. add creates an option where it belongs;
// depends is what its options need besides the type chosen, skip tells when
// the condition is not the rule's, json offers a rule written as JSON as
// well, and clear removes what a rule of a type chosen keeps no more
function options(add, { depends = {}, skip = () => false, json = false, clear = () => {} } = {}) {
  const config = openbox.profileConfig();

  const type = add(form.ListValue, '_type_choice', _('Rule type'));
  type.modalonly = true;
  type.default = 'domain_suffix';
  type.forcewrite = true;
  type.retain = true;
  if (Object.keys(depends).length)
    type.depends(depends);
  // the types, and for a rule of several conditions or a type set by hand
  // that one as well, for this rule only
  type.load = function (section_id) {
    const found = typeOf(uci.get(config, section_id) ?? {});

    this.keylist = [];
    this.vallist = [];
    Object.keys(TYPES).forEach((key) => this.value(key, key));
    if (json)
      this.value('json', 'JSON');
    if (found && !(found in TYPES) && found != 'logical' && found != 'json')
      this.value(found, (found == 'multiple') ? _('Multiple conditions') : found);

    // a logical rule turned standard starts from the default type
    return (found == 'logical') ? null : found;
  };
  // a rule keeps the field of its type only; flags are set here as they take
  // no value. A rule of several conditions keeps them. Called on the copy of
  // the option in the dialog, which reads its value
  type.write = type.remove = function (section_id) {
    const chosen = this.formvalue(section_id);
    if (!(chosen in TYPES || chosen == 'json') || skip(this, section_id))
      return;

    clear(section_id);
    MATCH_KEYS.filter((key) => key != chosen).forEach((key) => uci.unset(config, section_id, key));
    if (chosen != 'json')
      uci.unset(config, section_id, 'json');
    if (TYPES[chosen]?.kind == 'flag')
      uci.set(config, section_id, chosen, '1');
  };

  let o = add(form.DummyValue, '_multiple', ' ');
  o.modalonly = true;
  o.depends(Object.assign({ _type_choice: 'multiple' }, depends));
  o.cfgvalue = () => _('This rule has several conditions, set outside this page. Its action and comment can be changed here; its conditions stay as they are.');

  // the value of each type, shown for its type; values stay while another
  // type is chosen until the rule is saved
  Object.keys(TYPES).forEach((key) => {
    const spec = TYPES[key];

    switch (spec.kind) {
    case 'flag':
      o = add(form.DummyValue, '_value_' + key, _('Value'));
      o.cfgvalue = () => 'true';
      break;

    case 'rule_set':
      o = add(form.MultiValue, key, _('Value'));
      // rule sets added below are listed before they are saved
      o.load = function (section_id) {
        this.keylist = [];
        this.vallist = [];
        openbox.sectionChoices(this, 'rule_set');

        return form.MultiValue.prototype.load.call(this, section_id);
      };
      break;

    case 'choice':
      o = add(form.ListValue, key, _('Value'));
      spec.values.forEach((value) => o.value(value));
      break;

    case 'choices':
      o = add(form.MultiValue, key, _('Value'));
      spec.values.forEach((value) => o.value(value));
      break;

    case 'inbound':
      o = add(form.MultiValue, key, _('Value'));
      uci.sections('openbox', 'inbound')
        .filter((section) => section.type != 'direct' && section.tag)
        .forEach((section) => o.value(section.tag));
      break;

    default:
      o = add(form.DynamicList, key, _('Value'));
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
    o.depends(Object.assign({ _type_choice: key }, depends));
  });

  if (!json)
    return;

  o = add(form.TextValue, 'json', _('Value'));
  o.description = _('A <a href="%s" target="_blank" rel="noreferrer">sing-box route rule</a> as JSON, with conditions only, for what a type above cannot write: several conditions, or a logical rule.')
    .format('https://sing-box.sagernet.org/configuration/route/rule/');
  o.rows = 6;
  o.monospace = true;
  o.wrap = 'off';
  o.placeholder = JSON.stringify({ type: 'logical', mode: 'or', rules: [ { port: [ 80 ] }, { port: [ 443 ] } ] }, null, 2);
  o.modalonly = true;
  o.rmempty = false;
  o.validate = fields.validate;
  o.depends('_type_choice', 'json');
}

return baseclass.extend({
  MATCH_KEYS,
  typeOf,
  ruleExpr,
  ruleOf,
  typeText,
  valueCell,
  options
});
