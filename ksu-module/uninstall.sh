#!/system/bin/sh

if grep -q '^pathmask ' /proc/modules 2>/dev/null; then
	rmmod pathmask 2>/dev/null
fi
