'use strict';
'require baseclass';
'require form';
'require openbox.policy.common as common';

const { validateHeader, remote } = common;

// the fields of the Transport tab of the dialog of a node
return baseclass.extend({
  add(s) {
    let o;

    // transport, for vmess, vless and trojan

    o = s.taboption('transport', form.ListValue, 'transport_type', _('Transport protocol'));
    o.value('', 'TCP');
    o.value('ws', 'WebSocket');
    o.value('httpupgrade', 'HTTPUpgrade');
    o.value('grpc', 'gRPC');
    o.value('http', 'HTTP');
    o.value('quic', 'QUIC');
    o.modalonly = true;
    remote(o, ['vmess', 'vless', 'trojan']);

    o = s.taboption('transport', form.Value, 'transport_path', _('Path'));
    o.placeholder = '/';
    o.modalonly = true;
    ['ws', 'httpupgrade', 'http'].forEach((type) => o.depends('transport_type', type));

    // a list for http, of which HTTPUpgrade takes the first; WebSocket
    // has a Host header instead
    o = s.taboption('transport', form.DynamicList, 'transport_host', _('Host'));
    o.datatype = 'hostname';
    o.modalonly = true;
    ['httpupgrade', 'http'].forEach((type) => o.depends('transport_type', type));

    o = s.taboption('transport', form.Value, 'transport_method', _('HTTP method'));
    o.modalonly = true;
    o.depends('transport_type', 'http');

    o = s.taboption('transport', form.DynamicList, 'transport_headers', _('Headers'));
    o.placeholder = 'User-Agent: Mozilla/5.0';
    o.validate = validateHeader;
    o.modalonly = true;
    ['ws', 'httpupgrade', 'http'].forEach((type) => o.depends('transport_type', type));

    o = s.taboption('transport', form.Value, 'transport_service_name', _('gRPC service name'));
    o.modalonly = true;
    o.depends('transport_type', 'grpc');
  }
});
