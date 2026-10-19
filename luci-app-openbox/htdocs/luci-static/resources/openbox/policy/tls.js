'use strict';
'require baseclass';
'require form';
'require uci';
'require openbox.ui as openbox';
'require openbox.policy.common as common';

const { TLS_OPTIONAL, TLS_REQUIRED, UTLS_TYPES, UTLS_FINGERPRINTS, validateFields, parseFields, formatFields, remote } = common;

// the TLS options of a node by their fields in the JSON of the advanced
// editing, which takes them over: [ read from the JSON, write into it ]
const TLS_OPTIONS = {
  tls_server_name: [
    (tls) => tls.server_name ?? '',
    (tls, value) => tls.server_name = value || undefined
  ],
  tls_insecure: [
    (tls) => tls.insecure ? '1' : '0',
    (tls, value) => tls.insecure = (value == '1') || undefined
  ],
  // sing-box takes chrome when the fingerprint is left out
  tls_utls_fingerprint: [
    (tls) => tls.utls?.enabled ? (tls.utls.fingerprint || 'chrome') : '',
    (tls, value) => tls.utls = value ? { ...tls.utls, enabled: true, fingerprint: value } : undefined
  ],
  tls_reality_enabled: [
    (tls) => tls.reality?.enabled ? '1' : '0',
    (tls, value) => tls.reality = (value == '1') ? { ...tls.reality, enabled: true } : undefined
  ],
  tls_reality_public_key: [
    (tls) => tls.reality?.public_key ?? '',
    (tls, value) => tls.reality && (tls.reality.public_key = value || undefined)
  ],
  tls_reality_short_id: [
    (tls) => tls.reality?.short_id ?? '',
    (tls, value) => tls.reality && (tls.reality.short_id = value || undefined)
  ]
};

// the TLS options shown in the dialog of a node into the JSON of the
// advanced editing; JSON being typed that is not valid is left alone
function tlsOptionsToFields(section, section_id) {
  const field = section.getUIElement(section_id, 'tls_fields');
  const parsed = field ? parseFields(field.getValue()) : null;
  if (!parsed)
    return;

  // TLS is on wherever the JSON shows, so it says so first
  const tls = { enabled: true, ...parsed };
  for (const [name, [, write]] of Object.entries(TLS_OPTIONS)) {
    const option = section.children.find((option) => option.option == name);
    if (option?.isActive(section_id))
      write(tls, option.formvalue(section_id));
  }

  field.setValue(formatFields(tls));
}

// and back, once the JSON is edited
function tlsFieldsToOptions(section, section_id) {
  const tls = parseFields(section.getUIElement(section_id, 'tls_fields')?.getValue());
  if (!tls)
    return;

  for (const [name, [read]] of Object.entries(TLS_OPTIONS))
    section.getUIElement(section_id, name)?.setValue(read(tls));

  section.map.checkDepends();
}

// the fields of the TLS tab of the dialog of a node
return baseclass.extend({
  add(s) {
    let o;

    // tls; the options shown here and the JSON of the advanced editing
    // follow each other, and the JSON is what counts

    const syncTls = function (ev, section_id) {
      tlsOptionsToFields(this.section, section_id);
    };

    o = s.taboption('tls', form.Flag, 'tls_enabled', _('Enable TLS'));
    o.modalonly = true;
    remote(o, TLS_OPTIONAL);

    // the protocols that always use TLS show it on, and keep it so
    o = s.taboption('tls', form.Flag, '_tls_required', _('Enable TLS'));
    o.readonly = true;
    o.modalonly = true;
    o.cfgvalue = () => '1';
    o.write = o.remove = () => { };
    remote(o, TLS_REQUIRED);

    const tls = (option, types) => {
      types.forEach((type) => (TLS_OPTIONAL.includes(type))
        ? option.depends({ type: type, tls_enabled: '1' })
        : option.depends('type', type));
    };

    o = s.taboption('tls', form.Value, 'tls_server_name', _('TLS server name'));
    o.onchange = syncTls;
    o.datatype = 'hostname';
    o.modalonly = true;
    tls(o, [...TLS_OPTIONAL, ...TLS_REQUIRED]);

    const fullTls = [...TLS_OPTIONAL, ...TLS_REQUIRED.filter((type) => type != 'naive')];

    o = s.taboption('tls', form.Flag, 'tls_insecure', _('Skip certificate verification'));
    o.onchange = syncTls;
    o.modalonly = true;
    tls(o, fullTls);

    o = s.taboption('tls', form.ListValue, 'tls_utls_fingerprint', _('uTLS fingerprint'));
    o.onchange = syncTls;
    o.value('', _('None'));
    UTLS_FINGERPRINTS.forEach((fingerprint) => o.value(fingerprint));
    o.modalonly = true;
    tls(o, UTLS_TYPES);

    o = s.taboption('tls', form.Flag, 'tls_reality_enabled', _('Enable Reality'));
    o.onchange = syncTls;
    o.modalonly = true;
    tls(o, ['vless']);

    o = s.taboption('tls', form.Value, 'tls_reality_public_key', _('Reality public key'));
    o.onchange = syncTls;
    o.rmempty = false;
    o.modalonly = true;
    o.depends({ type: 'vless', tls_enabled: '1', tls_reality_enabled: '1' });

    o = s.taboption('tls', form.Value, 'tls_reality_short_id', _('Reality short ID'));
    o.onchange = syncTls;
    o.modalonly = true;
    o.depends({ type: 'vless', tls_enabled: '1', tls_reality_enabled: '1' });

    // all TLS fields as JSON, the options above included, taken as they are
    o = s.taboption('tls', form.TextValue, 'tls_fields', _('Advanced editing'));
    o.description = _('A JSON object of <a href="%s" target="_blank" rel="noreferrer">sing-box TLS fields</a>, which overrides the options above.')
      .format('https://sing-box.sagernet.org/configuration/shared/tls/#outbound');
    o.rows = 6;
    o.monospace = true;
    o.placeholder = JSON.stringify({ min_version: '1.2', ech: { enabled: true } }, null, 2);
    o.modalonly = true;
    // TLS is turned off by Enable TLS, where it may be, not here
    o.validate = function (section_id, value) {
      const valid = validateFields(section_id, value);
      if (valid !== true || parseFields(value)?.enabled !== false)
        return valid;

      return TLS_REQUIRED.includes(this.section.formvalue(section_id, 'type'))
        ? _('This protocol always uses TLS.') : _('Turn TLS off with Enable TLS.');
    };
    tls(o, [...TLS_OPTIONAL, ...TLS_REQUIRED]);
    // a node saved before shows the options it has
    o.cfgvalue = function (section_id) {
      const value = form.TextValue.prototype.cfgvalue.call(this, section_id);
      if (value)
        return value;

      const tls = { enabled: true };
      for (const [name, [, write]] of Object.entries(TLS_OPTIONS))
        write(tls, uci.get(openbox.profileConfig(), section_id, name));

      return formatFields(tls);
    };
    o.onchange = function (ev, section_id) {
      tlsFieldsToOptions(this.section, section_id);
    };
  }
});
