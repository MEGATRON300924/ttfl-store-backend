/**
 * Escapes the five characters that matter for breaking out of HTML text
 * content or attribute values. Every template in lib/email.ts must run
 * user-controlled strings (first name, store name, rejection reason, etc.)
 * through this before interpolating them — otherwise a customer named
 * `<img src=x onerror=alert(1)>` gets that executed in whoever's inbox
 * reads the email (spec §9 "email templates must safely escape
 * user-controlled content").
 */
export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const BRAND = {
  ember: "#E8622C",
  graphite900: "#1A1D24",
  graphite600: "#5B6472",
  cloud: "#F5F6F8",
  white: "#FFFFFF",
};

/**
 * Wraps template-specific body content in a consistent, responsive,
 * professional shell — header wordmark, content card, footer with
 * company name + support contact. Every template in lib/email.ts calls
 * this once instead of hand-rolling its own <html> document.
 *
 * Deliberately plain system font stack per spec §8 ("no weird fonts") —
 * email clients strip @font-face/webfonts anyway, so this is also just
 * correct practice, not merely a style preference.
 */
export function renderEmailLayout(params: {
  previewText?: string;
  heading: string;
  bodyHtml: string; // pre-built HTML from the caller — caller is responsible for escaping any interpolated values first
  ctaText?: string;
  ctaUrl?: string;
}): string {
  const { previewText, heading, bodyHtml, ctaText, ctaUrl } = params;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(heading)}</title>
</head>
<body style="margin:0;padding:0;background-color:${BRAND.cloud};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
${previewText ? `<div style="display:none;max-height:0;overflow:hidden;">${escapeHtml(previewText)}</div>` : ""}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${BRAND.cloud};padding:32px 16px;">
  <tr>
    <td align="center">
      <table role="presentation" width="100%" style="max-width:480px;" cellpadding="0" cellspacing="0">
        <tr>
          <td style="padding-bottom:24px;">
            <table role="presentation" cellpadding="0" cellspacing="0">
              <tr>
                <td style="background-color:${BRAND.ember};width:32px;height:32px;border-radius:6px;text-align:center;vertical-align:middle;font-family:monospace;font-size:14px;font-weight:600;color:${BRAND.white};">T</td>
                <td style="padding-left:8px;font-size:15px;font-weight:700;color:${BRAND.graphite900};">TTFL Store</td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="background-color:${BRAND.white};border-radius:10px;padding:32px;border:1px solid #D6DAE1;">
            <h1 style="margin:0 0 16px;font-size:20px;font-weight:700;color:${BRAND.graphite900};">${escapeHtml(heading)}</h1>
            <div style="font-size:14px;line-height:1.6;color:${BRAND.graphite900};">
              ${bodyHtml}
            </div>
            ${
              ctaText && ctaUrl
                ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:24px;">
                     <tr>
                       <td style="background-color:${BRAND.ember};border-radius:8px;">
                         <a href="${ctaUrl}" style="display:inline-block;padding:12px 24px;font-size:14px;font-weight:600;color:${BRAND.white};text-decoration:none;">${escapeHtml(ctaText)}</a>
                       </td>
                     </tr>
                   </table>`
                : ""
            }
          </td>
        </tr>
        <tr>
          <td style="padding-top:24px;text-align:center;font-size:12px;color:${BRAND.graphite600};">
            The Tron Forge Limited &middot; TTFL Store<br />
            Questions? Contact support through your account, or reply to this email.
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}
