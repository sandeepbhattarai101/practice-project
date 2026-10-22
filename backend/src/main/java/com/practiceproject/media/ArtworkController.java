package com.practiceproject.media;

import com.practiceproject.common.Tokens;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.util.HtmlUtils;

/**
 * Generates poster/backdrop/cinema artwork as SVG for the SAMPLE data, so the app looks
 * finished without using copyrighted posters. The design is derived from a hash of the
 * slug, so the same movie always gets the same artwork. Real movies use real image URLs.
 */
@RestController
public class ArtworkController {

    private static final String[][] PALETTES = {
            {"#1a0b2e", "#7b2cbf", "#f5b544"}, {"#03071e", "#9d0208", "#ffba08"}, {"#001219", "#005f73", "#94d2bd"},
            {"#10002b", "#3c096c", "#e0aaff"}, {"#0b090a", "#660708", "#e5383b"}, {"#0d1b2a", "#1b263b", "#e0e1dd"},
            {"#132a13", "#31572c", "#ecf39e"}, {"#2b2d42", "#8d99ae", "#ef233c"}, {"#1b1b1e", "#373f51", "#d8dbe2"},
            {"#240046", "#ff6d00", "#ffd60a"}};

    @GetMapping(value = "/api/media/artwork/{kind}/{slug}.svg", produces = "image/svg+xml")
    public ResponseEntity<String> artwork(@PathVariable String kind, @PathVariable String slug,
                                          @RequestParam(required = false) String title,
                                          @RequestParam(required = false) String subtitle) {
        String safeSlug = slug.replaceAll("[^a-z0-9-]", "");
        String label = title != null && !title.isBlank() ? title : titleFromSlug(safeSlug);
        String sub = subtitle == null ? "" : subtitle;
        int hash = Math.abs(Tokens.sha256Hex(safeSlug).hashCode());
        String[] p = PALETTES[hash % PALETTES.length];
        String svg = switch (kind) {
            case "backdrop" -> backdrop(label, sub, p, hash);
            case "cinema" -> cinema(label, p, hash);
            default -> poster(label, sub, p, hash);
        };
        return ResponseEntity.ok()
                .cacheControl(CacheControl.maxAge(Duration.ofDays(7)).cachePublic())
                .header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'")
                .body(svg);
    }

    private static String poster(String title, String sub, String[] p, int hash) {
        int cx = 150 + hash % 300;
        int cy = 250 + (hash / 7) % 300;
        var lines = wrap(title.toUpperCase(), 14);
        var sb = new StringBuilder();
        int y = 650 - (lines.size() - 1) * 34;
        for (String line : lines) {
            sb.append("<text x='300' y='").append(y).append("' text-anchor='middle' font-family='Georgia,serif' font-size='58' font-weight='700' fill='")
                    .append(p[2]).append("' letter-spacing='3'>").append(esc(line)).append("</text>");
            y += 68;
        }
        return """
                <svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 600 900' width='600' height='900'>
                <defs>
                  <radialGradient id='g' cx='%d' cy='%d' r='620' gradientUnits='userSpaceOnUse'>
                    <stop offset='0' stop-color='%s'/><stop offset='1' stop-color='%s'/>
                  </radialGradient>
                  <linearGradient id='v' x1='0' y1='0' x2='0' y2='1'>
                    <stop offset='0.45' stop-color='#000' stop-opacity='0'/><stop offset='1' stop-color='#000' stop-opacity='0.85'/>
                  </linearGradient>
                </defs>
                <rect width='600' height='900' fill='url(#g)'/>
                <circle cx='%d' cy='%d' r='%d' fill='%s' opacity='0.18'/>
                <circle cx='%d' cy='%d' r='%d' fill='none' stroke='%s' stroke-width='2' opacity='0.35'/>
                <rect width='600' height='900' fill='url(#v)'/>
                %s
                <text x='300' y='%d' text-anchor='middle' font-family='Arial,sans-serif' font-size='20' fill='#ffffff' opacity='0.75' letter-spacing='6'>%s</text>
                <text x='300' y='870' text-anchor='middle' font-family='Arial,sans-serif' font-size='14' fill='#ffffff' opacity='0.45' letter-spacing='4'>SAMPLE ARTWORK · PRACTICE PROJECT</text>
                </svg>""".formatted(cx, cy, p[1], p[0], cx, cy, 120 + hash % 120, p[2], 600 - cx, 900 - cy, 200 + hash % 90, p[2],
                sb, y + 10, esc(sub.toUpperCase()));
    }

    private static String backdrop(String title, String sub, String[] p, int hash) {
        int cx = 900 + hash % 800;
        return """
                <svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1920 820' width='1920' height='820'>
                <defs>
                  <radialGradient id='g' cx='%d' cy='300' r='1100' gradientUnits='userSpaceOnUse'>
                    <stop offset='0' stop-color='%s'/><stop offset='1' stop-color='%s'/>
                  </radialGradient>
                </defs>
                <rect width='1920' height='820' fill='url(#g)'/>
                <circle cx='%d' cy='330' r='%d' fill='%s' opacity='0.16'/>
                <circle cx='%d' cy='420' r='%d' fill='none' stroke='%s' stroke-width='3' opacity='0.25'/>
                <text x='%d' y='470' text-anchor='middle' font-family='Georgia,serif' font-size='120' font-weight='700' fill='%s' opacity='0.12'>%s</text>
                </svg>""".formatted(cx, p[1], p[0], cx, 260 + hash % 140, p[2], cx - 300, 420, p[2], cx, p[2],
                esc(title.toUpperCase()));
    }

    private static String cinema(String name, String[] p, int hash) {
        var seats = new StringBuilder();
        for (int row = 0; row < 6; row++) {
            for (int col = 0; col < 14; col++) {
                int x = 260 + col * 60 + (col >= 7 ? 40 : 0);
                int y = 360 + row * 52;
                seats.append("<rect x='").append(x).append("' y='").append(y).append("' width='42' height='34' rx='6' fill='")
                        .append(p[2]).append("' opacity='").append(0.15 + row * 0.08).append("'/>");
            }
        }
        return """
                <svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1400 700' width='1400' height='700'>
                <defs><linearGradient id='g' x1='0' y1='0' x2='0' y2='1'>
                  <stop offset='0' stop-color='%s'/><stop offset='1' stop-color='%s'/></linearGradient></defs>
                <rect width='1400' height='700' fill='url(#g)'/>
                <path d='M260 230 Q700 170 1140 230' stroke='%s' stroke-width='8' fill='none' opacity='0.8'/>
                %s
                <text x='700' y='130' text-anchor='middle' font-family='Georgia,serif' font-size='54' fill='#ffffff' opacity='0.85'>%s</text>
                </svg>""".formatted(p[1], p[0], p[2], seats, esc(name));
    }

    private static String titleFromSlug(String slug) {
        var words = new ArrayList<String>();
        for (String w : slug.split("-")) {
            if (!w.isEmpty()) {
                words.add(Character.toUpperCase(w.charAt(0)) + w.substring(1));
            }
        }
        return String.join(" ", words);
    }

    private static List<String> wrap(String text, int width) {
        var lines = new ArrayList<String>();
        var current = new StringBuilder();
        for (String word : text.split("\\s+")) {
            if (current.length() > 0 && current.length() + word.length() + 1 > width) {
                lines.add(current.toString());
                current.setLength(0);
            }
            if (current.length() > 0) {
                current.append(' ');
            }
            current.append(word);
        }
        if (current.length() > 0) {
            lines.add(current.toString());
        }
        return lines.size() > 4 ? lines.subList(0, 4) : lines;
    }

    private static String esc(String s) {
        return HtmlUtils.htmlEscape(s);
    }
}
