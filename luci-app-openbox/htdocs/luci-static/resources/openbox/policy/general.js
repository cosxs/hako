'use strict';
'require baseclass';
'require form';
'require uci';
'require openbox.ui as openbox';
'require openbox.policy.common as common';

const { NODE_TYPES, PASSWORD_REQUIRED, SS_METHODS, validateTag, remote, address } = common;

// the fields of the Basic tab of the dialog of a node: the server and
// what each protocol takes, in the order of the sing-box docs
return baseclass.extend({
  add(s) {
    let o;

    o = s.taboption('general', form.Value, 'tag', _('Name'));
    o.rmempty = false;
    o.validate = validateTag;

    o = s.taboption('general', form.ListValue, 'type', _('Protocol'));
    Object.keys(NODE_TYPES).forEach((type) => o.value(type, NODE_TYPES[type]));
    o.default = 'shadowsocks';
    o.textvalue = (section_id) => {
      const type = uci.get(openbox.profileConfig(), section_id, 'type');
      return NODE_TYPES[type] ?? '%h'.format(type ?? '-');
    };

    const realm = (option, depends) => option.depends({ type: 'hysteria2', realm_server_url: /./, ...depends });

    // the fields of all protocols in one order, which keeps the order each
    // protocol has in the sing-box docs; a field shows for its protocols only.
    // The version is one UCI option for snell and socks, each keeping its
    // value, as is the stream window for naive and the QUIC tab
    o = s.taboption('general', form.Value, 'server', _('Server'));
    o.datatype = 'host';
    o.rmempty = false;
    address(o);
    o.textvalue = (section_id) => {
      const server = uci.get(openbox.profileConfig(), section_id, 'server');
      const port = uci.get(openbox.profileConfig(), section_id, 'server_port');

      return server ? '%h'.format(port ? `${server}:${port}` : server) : '-';
    };

    o = s.taboption('general', form.Value, 'server_port', _('Port'));
    o.datatype = 'port';
    o.rmempty = false;
    o.modalonly = true;
    address(o);

    o = s.taboption('general', form.ListValue, 'method', _('Encryption method'));
    SS_METHODS.forEach((method) => o.value(method));
    o.default = '2022-blake3-aes-128-gcm';
    o.modalonly = true;
    o.depends('type', 'shadowsocks');

    o = s.taboption('general', form.Value, 'uuid', 'UUID');
    o.rmempty = false;
    o.modalonly = true;
    remote(o, ['vmess', 'vless', 'tuic']);

    o = s.taboption('general', form.ListValue, 'security', _('Encryption method'));
    ['auto', 'none', 'zero', 'aes-128-gcm', 'chacha20-poly1305', 'aes-128-ctr'].forEach((method) => o.value(method));
    o.default = 'auto';
    o.modalonly = true;
    o.depends('type', 'vmess');

    o = s.taboption('general', form.Value, 'alter_id', 'Alter ID');
    o.datatype = 'uinteger';
    o.placeholder = '0';
    o.modalonly = true;
    o.depends('type', 'vmess');

    o = s.taboption('general', form.Flag, 'global_padding', _('Global padding'));
    o.modalonly = true;
    o.depends('type', 'vmess');

    o = s.taboption('general', form.Flag, 'authenticated_length', _('Authenticated length'));
    o.modalonly = true;
    o.depends('type', 'vmess');

    o = s.taboption('general', form.ListValue, 'flow', _('XTLS flow'));
    o.value('', _('None'));
    o.value('xtls-rprx-vision');
    o.modalonly = true;
    o.depends('type', 'vless');

    // port hopping, in place of the port
    o = s.taboption('general', form.DynamicList, 'server_ports', _('Port ranges'));
    o.placeholder = '20000:30000';
    o.validate = (section_id, value) => (!value || /^\d+:\d+$/.test(value)) ? true : _('Expecting a range such as 1000:2000');
    o.modalonly = true;
    address(o, ['hysteria2']);

    o = s.taboption('general', form.Value, 'hop_interval', _('Hop interval'));
    openbox.duration(o, 's', _('seconds'));
    o.placeholder = '30';
    o.modalonly = true;
    address(o, ['hysteria2']);

    o = s.taboption('general', form.Value, 'hop_interval_max', _('Maximum hop interval'));
    openbox.duration(o, 's', _('seconds'));
    o.modalonly = true;
    o.depends({ type: 'hysteria2', realm_server_url: '' });

    o = s.taboption('general', form.Value, 'up_mbps', _('Upload bandwidth'));
    openbox.suffix(o, 'Mbps');
    o.datatype = 'uinteger';
    o.modalonly = true;
    o.depends('type', 'hysteria2');

    o = s.taboption('general', form.Value, 'down_mbps', _('Download bandwidth'));
    openbox.suffix(o, 'Mbps');
    o.datatype = 'uinteger';
    o.modalonly = true;
    o.depends('type', 'hysteria2');

    o = s.taboption('general', form.ListValue, 'obfs_type', _('Obfuscation'));
    o.value('', 'Salamander');
    o.value('gecko', 'Gecko');
    o.modalonly = true;
    o.depends('type', 'hysteria2');

    o = s.taboption('general', form.Value, 'obfs_password', _('Obfuscation password'));
    o.password = true;
    o.modalonly = true;
    o.depends('type', 'hysteria2');

    o = s.taboption('general', form.Value, 'obfs_min_packet_size', _('Minimum packet size'));
    openbox.suffix(o, _('bytes'));
    o.datatype = 'uinteger';
    o.placeholder = '512';
    o.modalonly = true;
    o.depends({ type: 'hysteria2', obfs_type: 'gecko' });

    o = s.taboption('general', form.Value, 'obfs_max_packet_size', _('Maximum packet size'));
    openbox.suffix(o, _('bytes'));
    o.datatype = 'uinteger';
    o.placeholder = '1200';
    o.modalonly = true;
    o.depends({ type: 'hysteria2', obfs_type: 'gecko' });

    o = s.taboption('general', form.ListValue, '_snell_version', _('Snell version'));
    o.ucioption = 'version';
    o.value('4', 'v4 / v5');
    o.value('6', 'v6');
    o.default = '4';
    // required by sing-box, so kept even as the default
    o.rmempty = false;
    o.retain = true;
    o.modalonly = true;
    o.depends('type', 'snell');

    o = s.taboption('general', form.Value, 'psk', _('Pre-shared key'));
    o.password = true;
    o.rmempty = false;
    o.modalonly = true;
    o.depends('type', 'snell');

    o = s.taboption('general', form.Value, 'userkey', _('User key'));
    o.password = true;
    o.modalonly = true;
    o.depends('type', 'snell');

    o = s.taboption('general', form.Flag, 'reuse', _('Connection reuse'));
    o.modalonly = true;
    o.depends('type', 'snell');

    o = s.taboption('general', form.Value, 'user', _('Username'));
    o.placeholder = 'root';
    o.modalonly = true;
    o.depends('type', 'ssh');

    o = s.taboption('general', form.ListValue, '_socks_version', _('SOCKS version'));
    o.ucioption = 'version';
    o.value('', 'SOCKS5');
    o.value('4', 'SOCKS4');
    o.value('4a', 'SOCKS4a');
    o.retain = true;
    o.modalonly = true;
    o.depends('type', 'socks');

    o = s.taboption('general', form.Value, 'username', _('Username'));
    o.modalonly = true;
    remote(o, ['naive', 'socks', 'http']);

    // shared by the protocols, of which some require it
    o = s.taboption('general', form.Value, 'password', _('Password'));
    o.password = true;
    o.modalonly = true;
    o.validate = function (section_id, value) {
      return (value || !PASSWORD_REQUIRED.includes(this.section.formvalue(section_id, 'type'))) ? true : _('non-empty value');
    };
    remote(o, ['shadowsocks', 'trojan', 'hysteria2', 'tuic', 'anytls', 'naive', 'ssh', 'socks', 'http']);

    // shadowsocks plugins
    o = s.taboption('general', form.ListValue, 'plugin', _('Plugin'));
    o.value('', _('None'));
    o.value('obfs-local');
    o.value('v2ray-plugin');
    o.modalonly = true;
    o.depends('type', 'shadowsocks');

    o = s.taboption('general', form.Value, 'plugin_opts', _('Plugin options'));
    o.placeholder = 'obfs=http;obfs-host=www.bing.com';
    o.modalonly = true;
    ['obfs-local', 'v2ray-plugin'].forEach((plugin) => o.depends({ type: 'shadowsocks', plugin: plugin }));

    o = s.taboption('general', form.ListValue, 'congestion_control', _('Congestion control'));
    o.value('', 'cubic');
    o.value('new_reno');
    o.value('bbr');
    o.modalonly = true;
    o.depends('type', 'tuic');

    o = s.taboption('general', form.ListValue, 'udp_relay_mode', _('UDP relay mode'));
    o.value('', 'native');
    o.value('quic');
    o.modalonly = true;
    o.depends('type', 'tuic');

    // in place of a relay mode
    o = s.taboption('general', form.Flag, 'udp_over_stream', 'UDP over Stream');
    o.modalonly = true;
    o.depends({ type: 'tuic', udp_relay_mode: '' });

    o = s.taboption('general', form.Flag, 'zero_rtt_handshake', _('0-RTT handshake'));
    o.modalonly = true;
    o.depends('type', 'tuic');

    o = s.taboption('general', form.Value, 'heartbeat', _('Heartbeat interval'));
    openbox.duration(o, 's', _('seconds'));
    o.placeholder = '10';
    o.modalonly = true;
    o.depends('type', 'tuic');

    o = s.taboption('general', form.ListValue, 'network', _('Network protocols'));
    o.value('', _('TCP and UDP'));
    o.value('tcp', _('TCP only'));
    o.value('udp', _('UDP only'));
    o.modalonly = true;
    remote(o, ['shadowsocks', 'vmess', 'vless', 'trojan', 'hysteria2', 'tuic', 'snell', 'socks']);

    // vmess and vless
    o = s.taboption('general', form.ListValue, 'packet_encoding', _('UDP packet encoding'));
    o.value('', _('Default'));
    o.value('packetaddr', 'packetaddr');
    o.value('xudp', 'xudp');
    o.modalonly = true;
    remote(o, ['vmess', 'vless']);

    o = s.taboption('general', form.ListValue, 'bbr_profile', _('BBR profile'));
    o.value('', 'standard');
    o.value('conservative');
    o.value('aggressive');
    o.modalonly = true;
    o.depends('type', 'hysteria2');

    o = s.taboption('general', form.Flag, 'brutal_debug', _('Brutal debug logs'));
    o.modalonly = true;
    o.depends('type', 'hysteria2');

    o = s.taboption('general', form.Flag, 'disable_chrome_parrot', _('Disable Chrome parrot'));
    o.modalonly = true;
    o.depends('type', 'hysteria2');

    o = s.taboption('general', form.Value, 'realm_server_url', _('Realm server URL'));
    o.datatype = 'url';
    o.placeholder = 'https://realm.example.com';
    o.modalonly = true;
    o.depends('type', 'hysteria2');

    o = s.taboption('general', form.Value, 'realm_token', _('Realm token'));
    o.password = true;
    o.modalonly = true;
    realm(o);

    o = s.taboption('general', form.Value, 'realm_realm_id', _('Realm ID'));
    o.rmempty = false;
    o.modalonly = true;
    realm(o);

    o = s.taboption('general', form.DynamicList, 'realm_stun_servers', _('STUN servers'));
    o.placeholder = 'stun.l.google.com:19302';
    o.rmempty = false;
    o.modalonly = true;
    realm(o);

    o = s.taboption('general', form.ListValue, 'realm_ip_version', _('IP version'));
    o.value('', _('IPv4 and IPv6'));
    o.value('4', 'IPv4');
    o.value('6', 'IPv6');
    o.modalonly = true;
    realm(o);

    o = s.taboption('general', form.Flag, 'realm_port_mapping_enabled', _('Port mapping'));
    o.modalonly = true;
    realm(o, { realm_ip_version: /^4?$/ });

    o = s.taboption('general', form.Value, 'realm_port_mapping_timeout', _('Port mapping timeout'));
    openbox.duration(o, 's', _('seconds'));
    o.placeholder = '10';
    o.modalonly = true;
    realm(o, { realm_ip_version: /^4?$/, realm_port_mapping_enabled: '1' });

    o = s.taboption('general', form.Value, 'realm_port_mapping_lifetime', _('Port mapping lifetime'));
    openbox.duration(o, 'm', _('minutes'));
    o.placeholder = '10';
    o.modalonly = true;
    realm(o, { realm_ip_version: /^4?$/, realm_port_mapping_enabled: '1' });

    // left empty, the default one of the route settings
    o = s.taboption('general', form.ListValue, 'realm_http_client', _('HTTP client'));
    o.modalonly = true;
    o.load = function (section_id) {
      this.keylist = [];
      this.vallist = [];
      openbox.sectionChoices(this, 'http_client', _('Default HTTP client'));

      return form.ListValue.prototype.load.call(this, section_id);
    };
    realm(o);

    o = s.taboption('general', form.Value, 'idle_session_check_interval', _('Idle session check interval'));
    openbox.duration(o, 's', _('seconds'));
    o.placeholder = '30';
    o.modalonly = true;
    o.depends('type', 'anytls');

    o = s.taboption('general', form.Value, 'idle_session_timeout', _('Idle session timeout'));
    openbox.duration(o, 's', _('seconds'));
    o.placeholder = '30';
    o.modalonly = true;
    o.depends('type', 'anytls');

    o = s.taboption('general', form.Value, 'min_idle_session', _('Minimum idle sessions'));
    o.datatype = 'uinteger';
    o.placeholder = '0';
    o.modalonly = true;
    o.depends('type', 'anytls');

    o = s.taboption('general', form.Value, 'client_metadata', _('Client metadata'));
    o.modalonly = true;
    o.depends('type', 'anytls');

    o = s.taboption('general', form.Value, 'insecure_concurrency', _('Concurrent connections'));
    o.datatype = 'uinteger';
    o.modalonly = true;
    o.depends('type', 'naive');

    o = s.taboption('general', form.DynamicList, 'extra_headers', _('Headers'));
    o.placeholder = 'User-Agent: Mozilla/5.0';
    o.validate = openbox.validateHeader;
    o.modalonly = true;
    o.depends('type', 'naive');

    // shared with the QUIC protocols, so each keeps its value
    o = s.taboption('general', form.Value, '_naive_stream_receive_window', _('Stream receive window'));
    o.ucioption = 'stream_receive_window';
    o.placeholder = '6MB';
    o.validate = openbox.validateSize;
    o.retain = true;
    o.modalonly = true;
    o.depends('type', 'naive');

    // socks and shadowsocks
    o = s.taboption('general', form.Flag, 'udp_over_tcp', 'UDP over TCP');
    o.modalonly = true;
    remote(o, ['socks', 'shadowsocks', 'naive']);

    o = s.taboption('general', form.Flag, 'quic', 'QUIC');
    o.modalonly = true;
    o.depends('type', 'naive');

    o = s.taboption('general', form.ListValue, 'quic_congestion_control', _('Congestion control'));
    o.value('', 'cubic');
    o.value('bbr');
    o.value('bbr2');
    o.value('reno');
    o.modalonly = true;
    o.depends({ type: 'naive', quic: '1' });

    o = s.taboption('general', form.Value, 'quic_session_receive_window', _('Session receive window'));
    o.placeholder = '15MB';
    o.validate = openbox.validateSize;
    o.modalonly = true;
    o.depends({ type: 'naive', quic: '1' });

    o = s.taboption('general', form.ListValue, 'obfs_mode', _('HTTP obfuscation'));
    o.value('', _('None'));
    o.value('http', 'HTTP');
    o.modalonly = true;
    o.depends({ type: 'snell', _snell_version: '4' });

    o = s.taboption('general', form.Value, 'obfs_host', _('Obfuscation host'));
    o.datatype = 'hostname';
    o.placeholder = 'bing.com';
    o.modalonly = true;
    o.depends({ type: 'snell', _snell_version: '4', obfs_mode: 'http' });

    o = s.taboption('general', form.ListValue, 'mode', _('Traffic shaping'));
    o.value('', 'default');
    o.value('unshaped');
    o.value('unsafe-raw');
    o.modalonly = true;
    o.depends({ type: 'snell', _snell_version: '6' });

    o = s.taboption('general', form.TextValue, 'private_key', _('Private key'));
    o.rows = 4;
    o.monospace = true;
    o.placeholder = '-----BEGIN OPENSSH PRIVATE KEY-----';
    o.modalonly = true;
    o.depends('type', 'ssh');

    o = s.taboption('general', form.Value, 'private_key_path', _('Private key file'));
    o.placeholder = '/etc/openbox/id_ed25519';
    o.modalonly = true;
    o.depends('type', 'ssh');

    o = s.taboption('general', form.Value, 'private_key_passphrase', _('Private key passphrase'));
    o.password = true;
    o.modalonly = true;
    o.depends('type', 'ssh');

    o = s.taboption('general', form.DynamicList, 'host_key', _('Host keys'));
    o.placeholder = 'ssh-ed25519 AAAA…';
    o.modalonly = true;
    o.depends('type', 'ssh');

    o = s.taboption('general', form.DynamicList, 'host_key_algorithms', _('Host key algorithms'));
    o.placeholder = 'ssh-ed25519';
    o.modalonly = true;
    o.depends('type', 'ssh');

    o = s.taboption('general', form.Value, 'client_version', _('Client version'));
    o.placeholder = 'SSH-2.0-OpenSSH_7.4p1';
    o.modalonly = true;
    o.depends('type', 'ssh');

    o = s.taboption('general', form.DynamicList, 'cipher', _('Ciphers'));
    o.placeholder = 'aes128-gcm@openssh.com';
    o.modalonly = true;
    o.depends('type', 'ssh');

    o = s.taboption('general', form.DynamicList, 'mac', _('MAC algorithms'));
    o.placeholder = 'hmac-sha2-256-etm@openssh.com';
    o.modalonly = true;
    o.depends('type', 'ssh');

    o = s.taboption('general', form.DynamicList, 'kex_algorithm', _('Key exchange algorithms'));
    o.placeholder = 'curve25519-sha256';
    o.modalonly = true;
    o.depends('type', 'ssh');

    o = s.taboption('general', form.Value, 'path', _('Path'));
    o.placeholder = '/';
    o.modalonly = true;
    o.depends('type', 'http');

    o = s.taboption('general', form.DynamicList, 'headers', _('Headers'));
    o.placeholder = 'User-Agent: Mozilla/5.0';
    o.validate = openbox.validateHeader;
    o.modalonly = true;
    o.depends('type', 'http');
  }
});
