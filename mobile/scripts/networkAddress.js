// Updates the LAN address in configuration files. Pure rule, no files, no network,
// network.js uses it.
//
// Why it's needed: Local services are reachable on a real iPhone only via the
// LAN IP of the machine, and that comes via DHCP: different at home than in
// the office. The app has managed without it since src/lib/supabaseAddress.ts
// (it knows the machine that provided its bundle). Edge Functions can't do
// that: they bake the address into SIGNED URLs, and the signature covers the
// machine name with it, bending it retroactively doesn't work.

// Only lines with an address are touched. This protects keys and tokens: no
// string that happens to look like an IP should be overwritten there.
const HAS_ADDRESS = /:\/\//;

// What applies only to your own network, and might mean something different
// tomorrow. Public addresses remain untouched.
const LOCAL =
  /\b(?:localhost|127\.0\.0\.1|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})\b/g;

function withNewAddress(content, newAddress) {
  return content
    .split('\n')
    .map((line) => (HAS_ADDRESS.test(line) ? line.replace(LOCAL, newAddress) : line))
    .join('\n');
}

module.exports = { withNewAddress };
