const SOCIAL = {
  instagram: ['instagram.com'],
  facebook: ['facebook.com', 'fb.com', 'm.facebook.com'],
  tiktok: ['tiktok.com'],
  linkedin: ['linkedin.com'],
  x: ['x.com', 'twitter.com'],
  youtube: ['youtube.com', 'youtu.be'],
  whatsapp: ['wa.me', 'api.whatsapp.com', 'web.whatsapp.com'],
  telegram: ['t.me', 'telegram.me', 'telegram.org'],
};

const CATEGORIES = {
  social: SOCIAL,
  link_aggregator: {
    linktree: ['linktr.ee'], beacons: ['beacons.ai'], bio_site: ['bio.site'],
    campsite: ['campsite.bio'], taplink: ['taplink.cc'],
  },
  marketplace: {
    ifood: ['ifood.com.br'], getninjas: ['getninjas.com.br'], doctoralia: ['doctoralia.com.br'],
    tripadvisor: ['tripadvisor.com.br', 'tripadvisor.com'], reclame_aqui: ['reclameaqui.com.br'],
  },
  free_builder: {
    wix: ['wixsite.com'], wordpress: ['wordpress.com'], blogspot: ['blogspot.com', 'blogspot.com.br'],
    google_sites: ['sites.google.com'], canva: ['canva.site'], webnode: ['webnode.page', 'webnode.com'],
  },
  shortener: {
    bitly: ['bit.ly'], tinyurl: ['tinyurl.com'], tco: ['t.co'], isgd: ['is.gd'],
  },
};

const PARKED = ['sedoparking.com', 'bodis.com', 'parkingcrew.net', 'hugedomains.com'];

function matchesHost(host, domain) {
  return host === domain || host.endsWith(`.${domain}`);
}

function findPlatform(host) {
  for (const [kind, platforms] of Object.entries(CATEGORIES)) {
    for (const [platform, domains] of Object.entries(platforms)) {
      if (domains.some((domain) => matchesHost(host, domain))) return { kind, platform };
    }
  }
  if (PARKED.some((domain) => matchesHost(host, domain))) return { kind: 'parked', platform: 'parking-provider' };
  return null;
}

module.exports = { CATEGORIES, PARKED, matchesHost, findPlatform };
