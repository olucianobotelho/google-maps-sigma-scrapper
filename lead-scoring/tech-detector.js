function detectTechnologies(input) {
  const html = String(input.html || "");
  const lower = html.toLowerCase();
  const scripts = input.scripts || [];
  const headers = input.headers || {};
  const allUrls = scripts.concat(input.styles || [], input.links || []).join(" ").toLowerCase();
  const technologies = [];
  const frameworks = [];
  const tracking = {
    googleAnalytics: /gtag\(|analytics\.js|googletagmanager\.com\/gtag\/js|G-[A-Z0-9]+|UA-\d+/i.test(html),
    googleTagManager: /GTM-[A-Z0-9]+|googletagmanager\.com\/gtm\.js/i.test(html),
    metaPixel: /fbq\(|connect\.facebook\.net\/.*fbevents/i.test(html),
    googleAdsConversion: /AW-\d+|googleadservices\.com\/pagead\/conversion/i.test(html),
    tiktokPixel: /ttq\.|analytics\.tiktok\.com/i.test(html),
    microsoftClarity: /clarity\.ms|clarity\(/i.test(html),
    hotjar: /hotjar|hj\(/i.test(html),
    linkedinInsight: /linkedin\.com\/insight|lintrk\(/i.test(html),
  };
  const add = (name, category, confidence, evidence) =>
    technologies.push({ name, category, confidence, evidence });
  const addFramework = (name, confidence, evidence) =>
    frameworks.push({ name, confidence, evidence });

  if (/wp-content|wp-includes|wp-json|generator["'][^>]*wordpress/i.test(html)) {
    add("WordPress", "cms", 0.95, ["wp-content/wp-json"]);
  }
  if (/wixstatic\.com|x-wix|wix-code/i.test(html + allUrls)) add("Wix", "cms", 0.9, ["wixstatic"]);
  if (/cdn\.shopify\.com|shopify\.theme|\/cart\.js/i.test(html + allUrls)) add("Shopify", "cms", 0.9, ["shopify assets"]);
  if (/squarespace|static1\.squarespace\.com/i.test(html + allUrls)) add("Squarespace", "cms", 0.85, ["squarespace assets"]);
  if (/webflow\.com|webflow\.js|w-webflow/i.test(html + allUrls)) add("Webflow", "cms", 0.9, ["webflow"]);
  if (/elementor/i.test(html + allUrls)) add("Elementor", "builder", 0.8, ["elementor"]);
  if (/_next\/static|__NEXT_DATA__/i.test(html + allUrls)) addFramework("Next.js", 0.92, ["_next/static"]);
  if (/data-reactroot|react-dom|__REACT_DEVTOOLS_GLOBAL_HOOK__/i.test(html + allUrls)) addFramework("React", 0.7, ["react markers"]);
  if (/vue(?:\.runtime|\.global|\.min)?\.js|data-v-/i.test(html + allUrls)) addFramework("Vue", 0.7, ["vue markers"]);
  if (/ng-version|angular/i.test(html + allUrls)) addFramework("Angular", 0.75, ["angular markers"]);
  if (/bootstrap/i.test(html + allUrls)) add("Bootstrap", "ui", 0.65, ["bootstrap"]);
  if (/jquery/i.test(html + allUrls)) add("jQuery", "library", 0.75, ["jquery"]);

  const infrastructure = {
    cloudflare: Object.entries(headers).some(([k, v]) => /cf-|cloudflare/i.test(`${k}:${v}`)),
    cdn: /cloudfront|akamai|fastly|jsdelivr|unpkg|cdnjs|cloudflare/i.test(allUrls),
  };

  return { technologies, frameworks, tracking, infrastructure };
}

module.exports = { detectTechnologies };
