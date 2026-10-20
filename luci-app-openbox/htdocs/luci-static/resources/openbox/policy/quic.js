'use strict';
'require baseclass';
'require form';
'require openbox.ui as openbox';
'require openbox.policy.common as common';

const { QUIC_TYPES } = common;

// the fields of the QUIC tab of the dialog of a node
return baseclass.extend({
  add(s) {
    let o;

    // quic, for hysteria2 and tuic

    const quic = (option) => QUIC_TYPES.forEach((type) => option.depends('type', type));

    o = s.taboption('quic', form.Value, 'initial_packet_size', _('Initial packet size'));
    openbox.suffix(o, _('bytes'));
    o.datatype = 'uinteger';
    o.modalonly = true;
    quic(o);

    o = s.taboption('quic', form.Flag, 'disable_path_mtu_discovery', _('Disable path MTU discovery'));
    o.modalonly = true;
    quic(o);

    o = s.taboption('quic', form.Value, 'idle_timeout', _('Idle timeout'));
    openbox.duration(o, 's', _('seconds'));
    o.modalonly = true;
    quic(o);

    o = s.taboption('quic', form.Value, 'keep_alive_period', _('Keepalive period'));
    openbox.duration(o, 's', _('seconds'));
    o.modalonly = true;
    quic(o);

    // shared with naive, so each keeps its value
    o = s.taboption('quic', form.Value, '_quic_stream_receive_window', _('Stream receive window'));
    o.ucioption = 'stream_receive_window';
    o.placeholder = '6MB';
    o.validate = openbox.validateSize;
    o.retain = true;
    o.modalonly = true;
    quic(o);

    o = s.taboption('quic', form.Value, 'connection_receive_window', _('Connection receive window'));
    o.placeholder = '15MB';
    o.validate = openbox.validateSize;
    o.modalonly = true;
    quic(o);

    o = s.taboption('quic', form.Value, 'max_concurrent_streams', _('Maximum concurrent streams'));
    o.datatype = 'uinteger';
    o.modalonly = true;
    quic(o);
  }
});
