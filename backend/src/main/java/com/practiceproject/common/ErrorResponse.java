package com.practiceproject.common;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.util.List;
import java.util.Map;

/** The single error shape every endpoint returns: {@code { error: {...}, requestId }}. */
public record ErrorResponse(Body error, String requestId) {

    @JsonInclude(JsonInclude.Include.NON_EMPTY)
    public record Body(String code, String message, List<FieldError> fieldErrors, Map<String, Object> details) {}

    public record FieldError(String field, String message) {}

    public static ErrorResponse of(String code, String message, String requestId) {
        return new ErrorResponse(new Body(code, message, List.of(), Map.of()), requestId);
    }
}
