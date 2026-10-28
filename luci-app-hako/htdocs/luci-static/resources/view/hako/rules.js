'use strict';
'require view';
'require form';
'require uci';
'require hako.ui as hako';
'require hako.fields as fields';
'require hako.rules.condition as condition';
'require hako.rules.logical as logical';

// show the label of a ListValue choice in a table instead of its value
function choiceText(section_id) {
  const value = this.cfgvalue(section_id) ?? this.default ?? '';
  const index = this.keylist.indexOf(value);

  return (index >= 0) ? this.vallist[index] : '%h'.format(value);
}

const RuleSection = logical.RuleSection.extend({
  // a new rule goes in front of the listed ones, behind the hidden rules
  handleAdd(ev, name) {
    const first = this.cfgsections()[0];
    const result = this.super('handleAdd', [ ev, name ]);
    const added = this.map.addedSection;

    if (first && added)
      uci.move(hako.profileConfig(), added, first);

    return result;
  }
});

return view.extend({
  load() {
    return hako.loadProfile();
  },

  render() {
    const m = new form.Map(hako.profileConfig());

    // one after another: the settings of the route, then the rules and the
    // rule sets they use
    this.renderSettings(m);
    this.renderRules(m);
    this.renderRuleSets(m);

    return m.render().then((node) => E([], [ ...hako.header(), node ]));
  },

  renderRules(m) {
    const config = hako.profileConfig();
    const rs = m.section(RuleSection, 'route_rule', _('Rules'),
      _('Rules are matched from top to bottom and the first match decides; drag a rule to change the order. Sniffing, DNS hijacking, private addresses and the Global and Direct modes are handled before these rules.'));
    rs.anonymous = true;
    rs.addremove = true;
    rs.sortable = true;
    rs.nodescriptions = true;
    rs.filter = (section_id) => !hako.isHidden(section_id);
    rs.modaltitle = _('Route rules');
    rs.tab('standard', _('Standard rule'));
    rs.tab('logical', _('Logical rule'));

    // enabled is only written when a rule is switched off; it is switched
    // in the table
    let o = rs.taboption('standard', form.Flag, 'enabled', _('Enable'));
    o.default = '1';
    o.editable = true;
    o.modalonly = false;

    // the table: type, value, action and comment, as the rules of Surge

    o = rs.taboption('standard', form.DummyValue, '_type', _('Type'));
    o.modalonly = false;
    o.textvalue = (section_id) => {
      const section = uci.get(config, section_id) ?? {};
      const text = condition.typeText(section);

      return (section.invert == '1') ? _('%s (inverted)').format(text) : text;
    };

    o = rs.taboption('standard', form.DummyValue, '_value', _('Value'));
    o.modalonly = false;
    o.textvalue = (section_id) => {
      const section = uci.get(config, section_id) ?? {};

      return (condition.typeOf(section) == 'logical') ? logical.rulesText(section) : condition.valueCell(section);
    };

    o = rs.taboption('standard', form.DummyValue, '_action', _('Action'));
    o.modalonly = false;
    o.textvalue = (section_id) => {
      const section = uci.get(config, section_id) ?? {};
      const action = section.action ?? 'route';

      if (action == 'reject')
        return (section.method == 'drop') ? 'reject (drop)' : 'reject';

      if (action != 'route')
        return '%h'.format(action);

      return section.outbound ? '%h'.format(hako.label(hako.lookup('outbound', section.outbound) ?? { tag: section.outbound })) : E('em', {}, _('None'));
    };

    o = rs.taboption('standard', form.DummyValue, '_comment', _('Comment'));
    o.modalonly = false;
    o.textvalue = (section_id) => '%h'.format(uci.get(config, section_id, 'comment') ?? '');

    // the dialog: the rule (a type and its value, or the mode and rules of
    // a logical rule), the action, and a comment
    logical.options(rs);

    logical.shared(rs, 'invert', form.Flag, _('Invert'), (o) => {
      o.description = _('The rule applies when the condition does not match.');
    });

    // what a matching connection gets; other actions set by hand are kept
    const actions = uci.sections(config, 'route_rule')
      .filter((section) => !hako.isHidden(section['.name']) && section.action && !(section.action in { route: 1, reject: 1 }))
      .map((section) => section.action);

    logical.shared(rs, 'action', form.ListValue, _('Action'), (o) => {
      o.value('', 'route');
      o.value('reject', 'reject');
      actions.forEach((action) => o.value(action));
    });

    logical.shared(rs, 'outbound', form.ListValue, _('Outbound'), (o, name) => {
      o.rmempty = false;
      o.depends(name('action'), '');
      o.depends(name('action'), 'route');
      hako.outboundChoices(o);
      if (uci.get(config, 'proxy'))
        o.default = 'proxy';
    });

    logical.shared(rs, 'method', form.ListValue, _('Reject with'), (o, name) => {
      o.value('', _('default: refuse the connection'));
      o.value('drop', _('drop: drop it silently'));
      o.depends(name('action'), 'reject');
    });

    logical.shared(rs, 'comment', form.Value, _('Comment'), () => {});
  },

  // rule sets, used by route rules, dns rules and the takeover bypass
  renderRuleSets(m) {
    const rs = m.section(form.GridSection, 'rule_set', _('Rule sets'),
      _('Lists of domains or addresses for route rules. DNS rules and the takeover bypass use them as well.'));
    // added with a dialog, without a section name to type first
    rs.anonymous = true;
    hako.named(rs, 'rule_set');
    rs.addremove = true;
    rs.nodescriptions = true;
    rs.modaltitle = (section_id) => _('Rule sets') + ' » ' + (uci.get(hako.profileConfig(), section_id, 'tag') || _('New rule set'));

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
      return (uci.get(hako.profileConfig(), section_id, 'type') == 'inline') ? '-' : choiceText.call(this, section_id);
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
    so.placeholder = '/usr/share/hako/rule-set/example.srs';
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
    so.validate = fields.validateRules;

    // left empty, the default one of the route settings below
    so = rs.option(form.ListValue, 'http_client', _('Download via'));
    hako.sectionChoices(so, 'http_client', _('Default HTTP client'));
    so.modalonly = true;
    so.depends('type', 'remote');

    so = rs.option(form.Value, 'update_interval', _('Update interval'));
    hako.duration(so, 'h', _('hours'));
    so.placeholder = '24';
    so.modalonly = true;
    so.depends('type', 'remote');
  },

  // the fields of the route besides the rules and the rule sets that a
  // router has a use for, in the order of sing-box; auto_detect_interface,
  // which the takeover needs, the generator always turns on
  renderSettings(m) {
    const s = m.section(form.NamedSection, 'route', 'route', _('Settings'));

    // where traffic no rule matched goes
    let o = s.option(form.ListValue, 'final', _('Default outbound'));
    o.description = _('Traffic that matches no rule uses this outbound.');
    hako.outboundChoices(o);

    // the MAC address and host name of LAN devices in the log, from the
    // neighbor table and the DHCP leases
    o = s.option(form.Flag, 'find_neighbor', _('Neighbor resolution'));
    o.description = _('Logs connections with the MAC address and host name of the LAN device.');
    o.default = '1';
    o.rmempty = false;

    o = s.option(form.DynamicList, 'dhcp_lease_files', _('DHCP lease files'));
    o.placeholder = '/tmp/dhcp.leases';

    // left empty, sing-box takes the first http client, or without one the
    // default outbound, which it no longer takes from 1.16
    o = s.option(form.ListValue, 'default_http_client', _('Default HTTP client'));
    hako.sectionChoices(o, 'http_client', uci.sections(hako.profileConfig(), 'http_client').length
      ? _('First HTTP client') : _('No HTTP client defined'));

    // the servers that are direct and not fakeip: nodes resolve their
    // servers through it before they are up
    o = s.option(form.ListValue, 'default_domain_resolver', _('Default domain resolver'));
    hako.sectionChoices(o, 'dns_server', null, (section) => section.type != 'fakeip' && !section.detour);
  }
});
