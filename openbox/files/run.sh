#!/bin/sh
# Run sing-box for procd. With a tproxy inbound the firewall rules are set up
# once sing-box runs and removed as soon as it exits, crashed or stopped, so
# traffic is never sent to a port nobody listens on; procd starts this again
# to respawn sing-box, which sets the rules up again. A tun inbound sets up its
# own rules, which a crashed sing-box leaves behind; they are removed before
# sing-box starts and after it exits. With a dns inbound, dnsmasq sends its
# queries to sing-box while it runs and goes back to its upstream servers,
# forgetting the fakeip answers it cached, as soon as sing-box exits.

. /usr/share/openbox/common.sh

pid=
port=
tz=
tun_route=

# decided once: the config file may be replaced by a reload before this exits
if uses_tun_route; then
	tun_route=1
fi

stop() {
	if [ -n "$pid" ]; then
		kill "$pid" 2> /dev/null
		wait "$pid"
	fi

	cleanup
	exit 0
}

cleanup() {
	firewall_down
	dnsmasq_down
	if [ -n "$tun_route" ]; then
		core_cleanup
	fi
	flush_dns_cache
}

trap stop TERM INT

if [ -n "$tun_route" ]; then
	core_cleanup
fi

# local time in the core log, for sing-box only: this shell, and dnsmasq
# restarted from it, keep reading /etc/TZ themselves
tz=$(core_localtime)
# shellcheck disable=SC2086
env ${tz:+TZ=$tz} "$CORE" run -c "$RUN_CONFIG" -D "$RUN_DIR" --disable-color >> "$CORE_LOG" 2>&1 &
pid=$!

if uses_tproxy || [ -n "$(dns_inbound)" ]; then
	# let sing-box listen before traffic and queries are sent to it
	if uses_tproxy; then
		port=$(tproxy_port)
	else
		port=$(dns_inbound)
		port=${port#* }
	fi
	# a raw JSON config may leave the port out: nothing to wait for
	if [ -n "$port" ]; then
		wait_for_listen "$port" "$pid"
		if [ $? = 2 ]; then
			log "sing-box does not listen on port $port yet, going on"
		fi
	fi
	if kill -0 "$pid" 2> /dev/null; then
		if uses_tproxy; then
			firewall_up
		fi
		dnsmasq_up
	fi
fi

# sing-box starts with the mode in its cache file: set the chosen one
apply_mode 20 &

wait "$pid"
status=$?

cleanup
log "sing-box exited ($status)"
exit "$status"
