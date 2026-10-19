'use strict';
'require baseclass';
'require form';
'require openbox.ui as openbox';
'require openbox.policy.common as common';

const { MULTIPLEX_TYPES, remote } = common;

// the fields of the Multiplex tab of the dialog of a node
return baseclass.extend({
  add(s) {
    let o;

    // multiplex; the maximum streams take the place of the maximum
    // connections and the minimum streams, so they are offered while
    // both are empty (not the other way round as well, as options that
    // hide each other would never show)

    o = s.taboption('multiplex', form.Flag, 'multiplex_enabled', _('Enable multiplexing'));
    o.modalonly = true;
    remote(o, MULTIPLEX_TYPES);

    const multiplex = (option, depends) =>
      MULTIPLEX_TYPES.forEach((type) => option.depends({ type: type, multiplex_enabled: '1', ...depends }));

    o = s.taboption('multiplex', form.ListValue, 'multiplex_protocol', _('Protocol'));
    o.value('', 'h2mux');
    o.value('smux');
    o.value('yamux');
    o.modalonly = true;
    multiplex(o);

    o = s.taboption('multiplex', form.Value, 'multiplex_max_connections', _('Maximum connections'));
    o.datatype = 'uinteger';
    o.placeholder = '4';
    o.modalonly = true;
    multiplex(o);

    o = s.taboption('multiplex', form.Value, 'multiplex_min_streams', _('Minimum streams'));
    o.datatype = 'uinteger';
    o.placeholder = '4';
    o.modalonly = true;
    multiplex(o);

    o = s.taboption('multiplex', form.Value, 'multiplex_max_streams', _('Maximum streams'));
    o.datatype = 'uinteger';
    o.modalonly = true;
    multiplex(o, { multiplex_max_connections: '', multiplex_min_streams: '' });

    o = s.taboption('multiplex', form.Flag, 'multiplex_padding', _('Padding'));
    o.modalonly = true;
    multiplex(o);

    o = s.taboption('multiplex', form.Flag, 'multiplex_brutal_enabled', 'TCP Brutal');
    o.modalonly = true;
    multiplex(o);

    o = s.taboption('multiplex', form.Value, 'multiplex_brutal_up_mbps', _('Upload bandwidth'));
    openbox.suffix(o, 'Mbps');
    o.datatype = 'uinteger';
    o.rmempty = false;
    o.modalonly = true;
    multiplex(o, { multiplex_brutal_enabled: '1' });

    o = s.taboption('multiplex', form.Value, 'multiplex_brutal_down_mbps', _('Download bandwidth'));
    openbox.suffix(o, 'Mbps');
    o.datatype = 'uinteger';
    o.rmempty = false;
    o.modalonly = true;
    multiplex(o, { multiplex_brutal_enabled: '1' });
  }
});
