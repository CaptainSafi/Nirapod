import adapter from '@sveltejs/adapter-static';
export default {
  kit: {
    // Static output only. There is no server-side rendering at request time:
    // the read path is pre-rendered JSON and HTML on a CDN, which is what
    // survives a viral spike on a free tier and what means the database is
    // never in the path of a reader.
    adapter: adapter({ pages: 'build', assets: 'build', fallback: '404.html', precompress: false }),
    prerender: { entries: ['*'] },

    // Content Security Policy, emitted as a meta tag on every prerendered page.
    //
    // 'self' everywhere is not boilerplate here: the whole privacy claim is that
    // this page talks to nobody. A CSP makes that enforceable rather than a
    // promise, so a stray script tag added later fails loudly instead of quietly
    // shipping the visitor list of a police-misconduct site to a third party.
    //
    // SvelteKit's own hydration script is inline; hash mode fingerprints it so
    // scripts stay locked to 'self' without an unsafe-inline escape hatch.
    // style-src does need unsafe-inline: the map and the scorecard bars set
    // widths and fills through style attributes.
    csp: {
      mode: 'hash',
      directives: {
        'default-src': ['self'],
        'script-src': ['self'],
        'style-src': ['self', 'unsafe-inline'],
        'img-src': ['self', 'data:'],
        'font-src': ['self'],
        'connect-src': ['self'],
        'form-action': ['none'],
        'frame-ancestors': ['none'],
        'base-uri': ['none'],
        'object-src': ['none'],
      },
    },
  },
};
