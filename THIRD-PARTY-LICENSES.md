# Third-party licences

MagScribe itself is MIT (see [LICENSE](LICENSE)). The application it builds also carries code and assets written
by other people, under their own terms. This file reproduces those terms, and it travels with the installed
application — electron-forge copies it to `resources/THIRD-PARTY-LICENSES.md` next to the binary — because
several of these licences ask to accompany the software, not merely the source repository.

## What is and is not inside the application

**Inside** (`resources/app.asar`): the bundled renderer and main process, which include compiled code from the
npm packages listed at the end of this file, the five Geist `.woff2` font files, and the ONNX Runtime Web
WebAssembly build.

**Alongside, from Electron itself**: `LICENSE` (Electron, MIT) and `LICENSES.chromium.html` (Chromium and its
own third parties, including Chromium's internal LGPL `libffmpeg.so` and the Apache-2.0 SwiftShader) are placed
in the application directory by electron-forge and are not repeated here.

**Not inside, and deliberately so:**

- **ffmpeg.** MagScribe ships no ffmpeg binary. It calls whatever ffmpeg the system already has, so the copy in
  use is the user's own and nothing is conveyed by us. (The common prebuilt static builds are GPLv3 — their
  x264/x265 encoders force it — while MagScribe only decodes audio and encodes Opus. See `src/audio.ts`.)
- **The speech model.** The Whisper weights are downloaded from the Hugging Face Hub by the user on first run
  and are never redistributed with the application. The model is
  [`onnx-community/whisper-large-v3-turbo`](https://huggingface.co/onnx-community/whisper-large-v3-turbo), an
  ONNX conversion — the conversion repository declares no licence tag of its own — of
  [`openai/whisper-large-v3-turbo`](https://huggingface.co/openai/whisper-large-v3-turbo), which is **MIT,
  © OpenAI**.
- **Claude Code.** The summary and chapters are produced by the `claude` CLI that the user installed and
  authenticated themselves. MagScribe bundles, modifies and redistributes nothing of Anthropic's.

---

## Geist (SIL Open Font License 1.1)

`@fontsource-variable/geist` 5.3.0 — five `.woff2` files ship inside the application.

> Copyright 2024 The Geist Project Authors (https://github.com/vercel/geist-font)
> Geist-Italic[wght].ttf: Copyright 2024 The Geist Project Authors (https://github.com/vercel/geist-font)

```
Copyright 2024 The Geist Project Authors (https://github.com/vercel/geist-font) Geist-Italic[wght].ttf: Copyright 2024 The Geist Project Authors (https://github.com/vercel/geist-font)

This Font Software is licensed under the SIL Open Font License, Version 1.1.
This license is copied below, and is also available with a FAQ at:
http://scripts.sil.org/OFL


-----------------------------------------------------------
SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007
-----------------------------------------------------------

PREAMBLE
The goals of the Open Font License (OFL) are to stimulate worldwide
development of collaborative font projects, to support the font creation
efforts of academic and linguistic communities, and to provide a free and
open framework in which fonts may be shared and improved in partnership
with others.

The OFL allows the licensed fonts to be used, studied, modified and
redistributed freely as long as they are not sold by themselves. The
fonts, including any derivative works, can be bundled, embedded,
redistributed and/or sold with any software provided that any reserved
names are not used by derivative works. The fonts and derivatives,
however, cannot be released under any other type of license. The
requirement for fonts to remain under this license does not apply
to any document created using the fonts or their derivatives.

DEFINITIONS
"Font Software" refers to the set of files released by the Copyright
Holder(s) under this license and clearly marked as such. This may
include source files, build scripts and documentation.

"Reserved Font Name" refers to any names specified as such after the
copyright statement(s).

"Original Version" refers to the collection of Font Software components as
distributed by the Copyright Holder(s).

"Modified Version" refers to any derivative made by adding to, deleting,
or substituting -- in part or in whole -- any of the components of the
Original Version, by changing formats or by porting the Font Software to a
new environment.

"Author" refers to any designer, engineer, programmer, technical
writer or other person who contributed to the Font Software.

PERMISSION & CONDITIONS
Permission is hereby granted, free of charge, to any person obtaining
a copy of the Font Software, to use, study, copy, merge, embed, modify,
redistribute, and sell modified and unmodified copies of the Font
Software, subject to the following conditions:

1) Neither the Font Software nor any of its individual components,
in Original or Modified Versions, may be sold by itself.

2) Original or Modified Versions of the Font Software may be bundled,
redistributed and/or sold with any software, provided that each copy
contains the above copyright notice and this license. These can be
included either as stand-alone text files, human-readable headers or
in the appropriate machine-readable metadata fields within text or
binary files as long as those fields can be easily viewed by the user.

3) No Modified Version of the Font Software may use the Reserved Font
Name(s) unless explicit written permission is granted by the corresponding
Copyright Holder. This restriction only applies to the primary font name as
presented to the users.

4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font
Software shall not be used to promote, endorse or advertise any
Modified Version, except to acknowledge the contribution(s) of the
Copyright Holder(s) and the Author(s) or with their explicit written
permission.

5) The Font Software, modified or unmodified, in part or in whole,
must be distributed entirely under this license, and must not be
distributed under any other license. The requirement for fonts to
remain under this license does not apply to any document created
using the Font Software.

TERMINATION
This license becomes null and void if any of the above conditions are
not met.

DISCLAIMER
THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT
OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE
COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL
DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM
OTHER DEALINGS IN THE FONT SOFTWARE.
```

---

## Lucide icons (ISC, with MIT-licensed icons derived from Feather)

`lucide-react` 1.43.0. Reproduced in full, both notices:

```
ISC License

Copyright (c) 2026 Lucide Icons and Contributors

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.

---

The following Lucide icons are derived from the Feather project:

airplay, alert-circle, alert-octagon, alert-triangle, aperture, arrow-down-circle, arrow-down-left, arrow-down-right, arrow-down, arrow-left-circle, arrow-left, arrow-right-circle, arrow-right, arrow-up-circle, arrow-up-left, arrow-up-right, arrow-up, at-sign, calendar, cast, check, chevron-down, chevron-left, chevron-right, chevron-up, chevrons-down, chevrons-left, chevrons-right, chevrons-up, circle, clipboard, clock, code, columns, command, compass, corner-down-left, corner-down-right, corner-left-down, corner-left-up, corner-right-down, corner-right-up, corner-up-left, corner-up-right, crosshair, database, divide-circle, divide-square, dollar-sign, download, external-link, feather, frown, hash, headphones, help-circle, info, italic, key, layout, life-buoy, link-2, link, loader, lock, log-in, log-out, maximize, meh, minimize, minimize-2, minus-circle, minus-square, minus, monitor, moon, more-horizontal, more-vertical, move, music, navigation-2, navigation, octagon, pause-circle, percent, plus-circle, plus-square, plus, power, radio, rss, search, server, share, shopping-bag, sidebar, smartphone, smile, square, table-2, tablet, target, terminal, trash-2, trash, triangle, tv, type, upload, x-circle, x-octagon, x-square, x, zoom-in, zoom-out

The MIT License (MIT) (for the icons listed above)

Copyright (c) 2013-present Cole Bemis

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## MIT

The licence of most packages below, among them React (© Meta Platforms, Inc. and affiliates), react-markdown,
sonner, Base UI and the `cn` helper. Each holds its own copyright; the terms are these:

```
MIT License

Copyright (c) <year> <copyright holders of the package in question>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR OTHER DEALINGS IN THE SOFTWARE.
```

---

## ISC

```
The ISC License

Copyright (c) Isaac Z. Schlueter and Contributors

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR
IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
```

---

## BSD-3-Clause

Covers protobuf.js and its `@protobufjs/*` helpers, `global-agent`, `roarr` and `sprintf-js`.

```
Copyright (c) 2016, Daniel Wirtz  All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are
met:

* Redistributions of source code must retain the above copyright
  notice, this list of conditions and the following disclaimer.
* Redistributions in binary form must reproduce the above copyright
  notice, this list of conditions and the following disclaimer in the
  documentation and/or other materials provided with the distribution.
* Neither the name of its author, nor the names of its contributors
  may be used to endorse or promote products derived from this software
  without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
"AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

---

Code generated by the command line utilities is owned by the owner
of the input file used when generating it. This code is not
standalone and requires a support library to be linked with it. This
support library is itself covered by the above license.
```

---

## Apache License 2.0

Covers `@huggingface/transformers` and `@huggingface/tokenizers`, `class-variance-authority`, `flatbuffers`,
`long`, `detect-libc` and `sharp`. None of these ships a `NOTICE` file, so there is no notice text to propagate
beyond the licence itself.

```

                                 Apache License
                           Version 2.0, January 2004
                        http://www.apache.org/licenses/

   TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

   1. Definitions.

      "License" shall mean the terms and conditions for use, reproduction,
      and distribution as defined by Sections 1 through 9 of this document.

      "Licensor" shall mean the copyright owner or entity authorized by
      the copyright owner that is granting the License.

      "Legal Entity" shall mean the union of the acting entity and all
      other entities that control, are controlled by, or are under common
      control with that entity. For the purposes of this definition,
      "control" means (i) the power, direct or indirect, to cause the
      direction or management of such entity, whether by contract or
      otherwise, or (ii) ownership of fifty percent (50%) or more of the
      outstanding shares, or (iii) beneficial ownership of such entity.

      "You" (or "Your") shall mean an individual or Legal Entity
      exercising permissions granted by this License.

      "Source" form shall mean the preferred form for making modifications,
      including but not limited to software source code, documentation
      source, and configuration files.

      "Object" form shall mean any form resulting from mechanical
      transformation or translation of a Source form, including but
      not limited to compiled object code, generated documentation,
      and conversions to other media types.

      "Work" shall mean the work of authorship, whether in Source or
      Object form, made available under the License, as indicated by a
      copyright notice that is included in or attached to the work
      (an example is provided in the Appendix below).

      "Derivative Works" shall mean any work, whether in Source or Object
      form, that is based on (or derived from) the Work and for which the
      editorial revisions, annotations, elaborations, or other modifications
      represent, as a whole, an original work of authorship. For the purposes
      of this License, Derivative Works shall not include works that remain
      separable from, or merely link (or bind by name) to the interfaces of,
      the Work and Derivative Works thereof.

      "Contribution" shall mean any work of authorship, including
      the original version of the Work and any modifications or additions
      to that Work or Derivative Works thereof, that is intentionally
      submitted to Licensor for inclusion in the Work by the copyright owner
      or by an individual or Legal Entity authorized to submit on behalf of
      the copyright owner. For the purposes of this definition, "submitted"
      means any form of electronic, verbal, or written communication sent
      to the Licensor or its representatives, including but not limited to
      communication on electronic mailing lists, source code control systems,
      and issue tracking systems that are managed by, or on behalf of, the
      Licensor for the purpose of discussing and improving the Work, but
      excluding communication that is conspicuously marked or otherwise
      designated in writing by the copyright owner as "Not a Contribution."

      "Contributor" shall mean Licensor and any individual or Legal Entity
      on behalf of whom a Contribution has been received by Licensor and
      subsequently incorporated within the Work.

   2. Grant of Copyright License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      copyright license to reproduce, prepare Derivative Works of,
      publicly display, publicly perform, sublicense, and distribute the
      Work and such Derivative Works in Source or Object form.

   3. Grant of Patent License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      (except as stated in this section) patent license to make, have made,
      use, offer to sell, sell, import, and otherwise transfer the Work,
      where such license applies only to those patent claims licensable
      by such Contributor that are necessarily infringed by their
      Contribution(s) alone or by combination of their Contribution(s)
      with the Work to which such Contribution(s) was submitted. If You
      institute patent litigation against any entity (including a
      cross-claim or counterclaim in a lawsuit) alleging that the Work
      or a Contribution incorporated within the Work constitutes direct
      or contributory patent infringement, then any patent licenses
      granted to You under this License for that Work shall terminate
      as of the date such litigation is filed.

   4. Redistribution. You may reproduce and distribute copies of the
      Work or Derivative Works thereof in any medium, with or without
      modifications, and in Source or Object form, provided that You
      meet the following conditions:

      (a) You must give any other recipients of the Work or
          Derivative Works a copy of this License; and

      (b) You must cause any modified files to carry prominent notices
          stating that You changed the files; and

      (c) You must retain, in the Source form of any Derivative Works
          that You distribute, all copyright, patent, trademark, and
          attribution notices from the Source form of the Work,
          excluding those notices that do not pertain to any part of
          the Derivative Works; and

      (d) If the Work includes a "NOTICE" text file as part of its
          distribution, then any Derivative Works that You distribute must
          include a readable copy of the attribution notices contained
          within such NOTICE file, excluding those notices that do not
          pertain to any part of the Derivative Works, in at least one
          of the following places: within a NOTICE text file distributed
          as part of the Derivative Works; within the Source form or
          documentation, if provided along with the Derivative Works; or,
          within a display generated by the Derivative Works, if and
          wherever such third-party notices normally appear. The contents
          of the NOTICE file are for informational purposes only and
          do not modify the License. You may add Your own attribution
          notices within Derivative Works that You distribute, alongside
          or as an addendum to the NOTICE text from the Work, provided
          that such additional attribution notices cannot be construed
          as modifying the License.

      You may add Your own copyright statement to Your modifications and
      may provide additional or different license terms and conditions
      for use, reproduction, or distribution of Your modifications, or
      for any such Derivative Works as a whole, provided Your use,
      reproduction, and distribution of the Work otherwise complies with
      the conditions stated in this License.

   5. Submission of Contributions. Unless You explicitly state otherwise,
      any Contribution intentionally submitted for inclusion in the Work
      by You to the Licensor shall be under the terms and conditions of
      this License, without any additional terms or conditions.
      Notwithstanding the above, nothing herein shall supersede or modify
      the terms of any separate license agreement you may have executed
      with Licensor regarding such Contributions.

   6. Trademarks. This License does not grant permission to use the trade
      names, trademarks, service marks, or product names of the Licensor,
      except as required for reasonable and customary use in describing the
      origin of the Work and reproducing the content of the NOTICE file.

   7. Disclaimer of Warranty. Unless required by applicable law or
      agreed to in writing, Licensor provides the Work (and each
      Contributor provides its Contributions) on an "AS IS" BASIS,
      WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
      implied, including, without limitation, any warranties or conditions
      of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A
      PARTICULAR PURPOSE. You are solely responsible for determining the
      appropriateness of using or redistributing the Work and assume any
      risks associated with Your exercise of permissions under this License.

   8. Limitation of Liability. In no event and under no legal theory,
      whether in tort (including negligence), contract, or otherwise,
      unless required by applicable law (such as deliberate and grossly
      negligent acts) or agreed to in writing, shall any Contributor be
      liable to You for damages, including any direct, indirect, special,
      incidental, or consequential damages of any character arising as a
      result of this License or out of the use or inability to use the
      Work (including but not limited to damages for loss of goodwill,
      work stoppage, computer failure or malfunction, or any and all
      other commercial damages or losses), even if such Contributor
      has been advised of the possibility of such damages.

   9. Accepting Warranty or Additional Liability. While redistributing
      the Work or Derivative Works thereof, You may choose to offer,
      and charge a fee for, acceptance of support, warranty, indemnity,
      or other liability obligations and/or rights consistent with this
      License. However, in accepting such obligations, You may act only
      on Your own behalf and on Your sole responsibility, not on behalf
      of any other Contributor, and only if You agree to indemnify,
      defend, and hold each Contributor harmless for any liability
      incurred by, or claims asserted against, such Contributor by reason
      of your accepting any such warranty or additional liability.

   END OF TERMS AND CONDITIONS

   APPENDIX: How to apply the Apache License to your work.

      To apply the Apache License to your work, attach the following
      boilerplate notice, with the fields enclosed by brackets "[]"
      replaced with your own identifying information. (Don't include
      the brackets!)  The text should be enclosed in the appropriate
      comment syntax for the file format. We also recommend that a
      file or class name and description of purpose be included on the
      same "printed page" as the copyright notice for easier
      identification within third-party archives.

   Copyright [yyyy] [name of copyright owner]

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.
```

---

## Packages

Every npm package reachable from the modules MagScribe imports, i.e. a superset of what the bundler actually
inlines. Regenerate after a dependency change.

| Package | Version | Licence |
|---|---|---|
| `@babel/runtime` | 7.29.7 | MIT |
| `@base-ui/react` | 1.8.0 | MIT |
| `@base-ui/utils` | 0.4.0 | MIT |
| `@floating-ui/core` | 1.8.0 | MIT |
| `@floating-ui/dom` | 1.8.0 | MIT |
| `@floating-ui/react-dom` | 2.1.9 | MIT |
| `@floating-ui/utils` | 0.2.12 | MIT |
| `@fontsource-variable/geist` | 5.3.0 | OFL-1.1 |
| `@huggingface/jinja` | 0.5.10 | MIT |
| `@huggingface/tokenizers` | 0.1.3 | Apache-2.0 |
| `@huggingface/transformers` | 4.2.0 | Apache-2.0 |
| `@img/colour` | 1.1.0 | MIT |
| `@protobufjs/aspromise` | 1.1.2 | BSD-3-Clause |
| `@protobufjs/base64` | 1.1.2 | BSD-3-Clause |
| `@protobufjs/codegen` | 2.0.5 | BSD-3-Clause |
| `@protobufjs/eventemitter` | 1.1.1 | BSD-3-Clause |
| `@protobufjs/fetch` | 1.1.1 | BSD-3-Clause |
| `@protobufjs/float` | 1.0.2 | BSD-3-Clause |
| `@protobufjs/path` | 1.1.2 | BSD-3-Clause |
| `@protobufjs/pool` | 1.1.0 | BSD-3-Clause |
| `@protobufjs/utf8` | 1.1.2 | BSD-3-Clause |
| `@types/debug` | 4.1.13 | MIT |
| `@types/estree` | 1.0.9 | MIT |
| `@types/estree-jsx` | 1.0.5 | MIT |
| `@types/hast` | 3.0.5 | MIT |
| `@types/mdast` | 4.0.4 | MIT |
| `@types/ms` | 2.1.0 | MIT |
| `@types/node` | 26.5.0 | MIT |
| `@types/unist` | 3.0.3 | MIT |
| `@ungap/structured-clone` | 1.4.0 | ISC |
| `adm-zip` | 0.5.18 | MIT |
| `bail` | 2.0.2 | MIT |
| `boolean` | 3.2.0 | MIT |
| `ccount` | 2.0.1 | MIT |
| `character-entities` | 2.0.2 | MIT |
| `character-entities-html4` | 2.1.0 | MIT |
| `character-entities-legacy` | 3.0.0 | MIT |
| `character-reference-invalid` | 2.0.1 | MIT |
| `class-variance-authority` | 0.7.1 | Apache-2.0 |
| `clsx` | 2.1.1 | MIT |
| `cn` | 0.2.6 | MIT |
| `comma-separated-tokens` | 2.0.3 | MIT |
| `debug` | 4.4.3 | MIT |
| `decode-named-character-reference` | 1.3.0 | MIT |
| `define-data-property` | 1.1.4 | MIT |
| `define-properties` | 1.2.1 | MIT |
| `dequal` | 2.0.3 | MIT |
| `detect-libc` | 2.1.2 | Apache-2.0 |
| `detect-node` | 2.1.0 | MIT |
| `devlop` | 1.1.0 | MIT |
| `es-define-property` | 1.0.1 | MIT |
| `es-errors` | 1.3.0 | MIT |
| `es6-error` | 4.1.1 | MIT |
| `escape-string-regexp` | 4.0.0 | MIT |
| `estree-util-is-identifier-name` | 3.0.0 | MIT |
| `extend` | 3.0.2 | MIT |
| `flatbuffers` | 25.9.23 | Apache-2.0 |
| `global-agent` | 3.0.0 | BSD-3-Clause |
| `globalthis` | 1.0.4 | MIT |
| `gopd` | 1.2.0 | MIT |
| `guid-typescript` | 1.0.9 | ISC |
| `has-property-descriptors` | 1.0.2 | MIT |
| `hast-util-to-jsx-runtime` | 2.3.6 | MIT |
| `hast-util-whitespace` | 3.0.0 | MIT |
| `html-url-attributes` | 3.0.1 | MIT |
| `inline-style-parser` | 0.2.7 | MIT |
| `is-alphabetical` | 2.0.1 | MIT |
| `is-alphanumerical` | 2.0.1 | MIT |
| `is-decimal` | 2.0.1 | MIT |
| `is-hexadecimal` | 2.0.1 | MIT |
| `is-plain-obj` | 4.1.0 | MIT |
| `json-stringify-safe` | 5.0.1 | ISC |
| `long` | 5.3.2 | Apache-2.0 |
| `longest-streak` | 3.1.0 | MIT |
| `lucide-react` | 1.43.0 | ISC |
| `matcher` | 3.0.0 | MIT |
| `mdast-util-from-markdown` | 2.0.3 | MIT |
| `mdast-util-mdx-expression` | 2.0.1 | MIT |
| `mdast-util-mdx-jsx` | 3.2.0 | MIT |
| `mdast-util-mdxjs-esm` | 2.0.1 | MIT |
| `mdast-util-phrasing` | 4.1.0 | MIT |
| `mdast-util-to-hast` | 13.2.1 | MIT |
| `mdast-util-to-markdown` | 2.1.2 | MIT |
| `mdast-util-to-string` | 4.0.0 | MIT |
| `micromark` | 4.0.2 | MIT |
| `micromark-core-commonmark` | 2.0.3 | MIT |
| `micromark-factory-destination` | 2.0.1 | MIT |
| `micromark-factory-label` | 2.0.1 | MIT |
| `micromark-factory-space` | 2.0.1 | MIT |
| `micromark-factory-title` | 2.0.1 | MIT |
| `micromark-factory-whitespace` | 2.0.1 | MIT |
| `micromark-util-character` | 2.1.1 | MIT |
| `micromark-util-chunked` | 2.0.1 | MIT |
| `micromark-util-classify-character` | 2.0.1 | MIT |
| `micromark-util-combine-extensions` | 2.0.1 | MIT |
| `micromark-util-decode-numeric-character-reference` | 2.0.2 | MIT |
| `micromark-util-decode-string` | 2.0.1 | MIT |
| `micromark-util-encode` | 2.0.1 | MIT |
| `micromark-util-html-tag-name` | 2.0.1 | MIT |
| `micromark-util-normalize-identifier` | 2.0.1 | MIT |
| `micromark-util-resolve-all` | 2.0.1 | MIT |
| `micromark-util-sanitize-uri` | 2.0.1 | MIT |
| `micromark-util-subtokenize` | 2.1.0 | MIT |
| `micromark-util-symbol` | 2.0.1 | MIT |
| `micromark-util-types` | 2.0.2 | MIT |
| `ms` | 2.1.3 | MIT |
| `object-keys` | 1.1.1 | MIT |
| `onnxruntime-common` | 1.24.3 | MIT |
| `onnxruntime-node` | 1.24.3 | MIT |
| `onnxruntime-web` | 1.26.0-dev.20260416-b7804b056c | MIT |
| `parse-entities` | 4.0.2 | MIT |
| `platform` | 1.3.6 | MIT |
| `property-information` | 7.2.0 | MIT |
| `protobufjs` | 7.6.6 | BSD-3-Clause |
| `react` | 19.2.8 | MIT |
| `react-dom` | 19.2.8 | MIT |
| `react-markdown` | 10.1.0 | MIT |
| `remark-parse` | 11.0.0 | MIT |
| `remark-rehype` | 11.1.2 | MIT |
| `reselect` | 5.3.0 | MIT |
| `roarr` | 2.15.4 | BSD-3-Clause |
| `scheduler` | 0.27.0 | MIT |
| `semver` | 7.8.5 | ISC |
| `semver-compare` | 1.0.0 | MIT |
| `serialize-error` | 7.0.1 | MIT |
| `sharp` | 0.34.5 | Apache-2.0 |
| `sonner` | 2.0.8 | MIT |
| `space-separated-tokens` | 2.0.2 | MIT |
| `sprintf-js` | 1.1.3 | BSD-3-Clause |
| `stringify-entities` | 4.0.4 | MIT |
| `style-to-js` | 1.1.21 | MIT |
| `style-to-object` | 1.0.14 | MIT |
| `trim-lines` | 3.0.1 | MIT |
| `trough` | 2.2.0 | MIT |
| `tw-animate-css` | 1.4.0 | MIT |
| `type-fest` | 0.20.2 | (MIT OR CC0-1.0) |
| `undici-types` | 8.9.0 | MIT |
| `unified` | 11.0.5 | MIT |
| `unist-util-is` | 6.0.1 | MIT |
| `unist-util-position` | 5.0.0 | MIT |
| `unist-util-stringify-position` | 4.0.0 | MIT |
| `unist-util-visit` | 5.1.0 | MIT |
| `unist-util-visit-parents` | 6.0.2 | MIT |
| `use-sync-external-store` | 1.6.0 | MIT |
| `vfile` | 6.0.3 | MIT |
| `vfile-message` | 4.0.3 | MIT |
| `zwitch` | 2.0.4 | MIT |
`sharp` and its platform-specific `@img/sharp-*` binaries (some of them LGPL-3.0) are a dependency of
`@huggingface/transformers` for image models. MagScribe transcribes audio, never loads that code path, and the
bundler leaves it out of the application — nothing from it is distributed.
