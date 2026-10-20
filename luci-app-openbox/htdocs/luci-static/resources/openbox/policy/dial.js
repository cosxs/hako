'use strict';
'require baseclass';
'require openbox.fields as fields';

// the fields of the Dial tab of the dialog of a node
return baseclass.extend({
  add(s) {
    // dial fields, written as JSON and taken as they are; a detour
    // connects through another node or group
    fields.add(s, 'dial', 'dial_fields', _('Dial fields'),
      _('A JSON object of <a href="%s" target="_blank" rel="noreferrer">sing-box dial fields</a>.')
        .format('https://sing-box.sagernet.org/configuration/shared/dial/'), {
        placeholder: JSON.stringify({ bind_interface: 'pppoe-wan', connect_timeout: '5s', tcp_fast_open: true }, null, 2)
      });
  }
});
