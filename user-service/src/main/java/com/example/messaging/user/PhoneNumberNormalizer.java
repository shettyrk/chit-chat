package com.example.messaging.user;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

@Component
public class PhoneNumberNormalizer {
    private final String defaultCountryCode;

    public PhoneNumberNormalizer(@Value("${app.phone.default-country-code:+91}") String defaultCountryCode) {
        this.defaultCountryCode = normalizeCountryCode(defaultCountryCode);
    }

    public String normalize(String value) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("Phone number is required");
        }

        String trimmed = value.trim();
        String digits = trimmed.replaceAll("\\D", "");
        if (digits.isBlank()) {
            throw new IllegalArgumentException("Phone number is invalid");
        }

        String normalized;
        if (trimmed.startsWith("+")) {
            normalized = "+" + digits;
        } else if (trimmed.startsWith("00") && digits.length() > 2) {
            normalized = "+" + digits.substring(2);
        } else if (defaultCountryCode != null && !defaultCountryCode.isBlank()) {
            String countryDigits = defaultCountryCode.substring(1);
            normalized = digits.startsWith(countryDigits) && digits.length() > 10
                    ? "+" + digits
                    : defaultCountryCode + digits;
        } else {
            throw new IllegalArgumentException("Use an international phone number with country code");
        }

        if (!normalized.matches("^\\+[1-9]\\d{7,14}$")) {
            throw new IllegalArgumentException("Phone number must be in international format");
        }
        return normalized;
    }

    private String normalizeCountryCode(String value) {
        if (value == null || value.isBlank()) return "";
        String digits = value.trim().replaceAll("\\D", "");
        return digits.isBlank() ? "" : "+" + digits;
    }
}

