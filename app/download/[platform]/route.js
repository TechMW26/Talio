import { NextResponse } from 'next/server'

const GITHUB_REPO = 'avirajsharma-ops/Talio'
const GITHUB_API = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`

// Map platform slugs to asset filename patterns
const PLATFORM_PATTERNS = {
  'mac-arm64': /Talio-.*-arm64\.dmg$/,
  'mac-intel': /Talio-.*-x64\.dmg$/,
  'mac': /Talio-.*-arm64\.dmg$/, // Default Mac = Apple Silicon
  'windows': /Talio\.Setup\..*\.exe$/,
  'win': /Talio\.Setup\..*\.exe$/,
}

export async function GET(request, { params }) {
  const { platform } = await params

  const pattern = PLATFORM_PATTERNS[platform]
  if (!pattern) {
    return NextResponse.json(
      { error: 'Invalid platform. Use: mac-arm64, mac-intel, mac, windows, or win' },
      { status: 400 }
    )
  }

  try {
    const res = await fetch(GITHUB_API, {
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'Talio-Download-Redirect',
      },
      next: { revalidate: 300 }, // Cache for 5 minutes
    })

    if (!res.ok) {
      throw new Error(`GitHub API returned ${res.status}`)
    }

    const release = await res.json()
    const asset = release.assets?.find(a => pattern.test(a.name))

    if (!asset) {
      return NextResponse.json(
        { error: `No ${platform} build found in latest release (${release.tag_name})` },
        { status: 404 }
      )
    }

    return NextResponse.redirect(asset.browser_download_url, 302)
  } catch (error) {
    // Fallback: redirect to the releases page
    return NextResponse.redirect(
      `https://github.com/${GITHUB_REPO}/releases/latest`,
      302
    )
  }
}
