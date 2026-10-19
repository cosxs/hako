'use strict';
'require baseclass';
'require form';
'require openbox.policy.common as common';

const { validateFields } = common;

// the fields of the Dial tab of the dialog of a node
return baseclass.extend({
  add(s) {
    let o;

    // dial fields, written as JSON and taken as they are; a detour
    // connects through another node or group
    o = s.taboption('dial', form.TextValue, 'dial_fields', _('Dial fields'));
    o.description = _('A JSON object of <a href="%s" target="_blank" rel="noreferrer">sing-box dial fields</a>.')
      .format('https://sing-box.sagernet.org/configuration/shared/dial/');
    o.rows = 6;
    o.monospace = true;
    o.placeholder = JSON.stringify({ bind_interface: 'pppoe-wan', connect_timeout: '5s', tcp_fast_open: true }, null, 2);
    o.modalonly = true;
    o.validate = validateFields;
  }
});
