# Notice

YapTok is an independent open source project by the makers of Yapin' and
SlopTube. It is released under the MIT license (see `LICENSE`).

## Where the code started

YapTok began as a copy of parts of SlopTube (MIT, same owner): the Supabase
clients and settings handling, the feature flag logic, the sign up and sign in
forms, the multipart upload to Cloudflare R2, the media route, the encoder
worker, the deploy scripts and the secret scan. Everything about the product
itself (the feed, creator pages, upload form, the admin panel and the database
schema) was written for YapTok.

## Our own name and look

The name YapTok, the note mark and the orange and gold palette are
this project's own (see `lib/brand.ts`). The icons are drawn in
`components/icons.tsx`. YapTok is not affiliated with, endorsed by or
connected to any other video or social app, and it does not use anyone else's
logo, colors, sounds or wording.

## Other people's work

- Roboto, the typeface, is licensed under the Apache License 2.0.
- hls.js plays the clips (Apache License 2.0).
- The libraries in `package.json` and `worker/package.json` keep their own licenses.
- ffmpeg runs in the encoder image as a separate program; it is not linked into
  this code.

All the people and clips in the screenshots and in the local test data are
made up.
