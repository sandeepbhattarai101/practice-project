package com.practiceproject.common;

import java.math.BigDecimal;
import java.text.NumberFormat;
import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.Locale;

/** Human-readable formatting for emails and CSV exports (UK style: DD/MM/YYYY). */
public final class Formats {

    private static final DateTimeFormatter DATE_TIME = DateTimeFormatter.ofPattern("EEE dd/MM/yyyy, h:mm a", Locale.UK);
    private static final DateTimeFormatter DATE = DateTimeFormatter.ofPattern("dd/MM/yyyy", Locale.UK);

    private Formats() {}

    public static String money(long minor, String symbol) {
        NumberFormat nf = NumberFormat.getNumberInstance(Locale.UK);
        nf.setMinimumFractionDigits(minor % 100 == 0 ? 0 : 2);
        nf.setMaximumFractionDigits(2);
        return symbol + " " + nf.format(BigDecimal.valueOf(minor, 2));
    }

    /** Plain decimal for CSV: 1250.50 */
    public static String decimal(long minor) {
        return BigDecimal.valueOf(minor, 2).toPlainString();
    }

    public static String dateTime(Instant instant, String zone) {
        return DATE_TIME.format(instant.atZone(ZoneId.of(zone)));
    }

    public static String date(Instant instant, String zone) {
        return DATE.format(instant.atZone(ZoneId.of(zone)));
    }
}
