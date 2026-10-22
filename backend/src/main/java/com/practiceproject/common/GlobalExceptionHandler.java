package com.practiceproject.common;

import jakarta.validation.ConstraintViolationException;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.dao.PessimisticLockingFailureException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.orm.ObjectOptimisticLockingFailureException;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.authentication.AnonymousAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.HttpMediaTypeNotSupportedException;
import org.springframework.web.HttpRequestMethodNotSupportedException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.MissingRequestHeaderException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.context.request.async.AsyncRequestNotUsableException;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.servlet.resource.NoResourceFoundException;

/**
 * Maps exceptions to the standard error JSON. Internal details (SQL, stack traces)
 * are logged with the request id but never sent to the client.
 */
@RestControllerAdvice
public class GlobalExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

    @ExceptionHandler(ApiException.class)
    ResponseEntity<ErrorResponse> handleApi(ApiException ex) {
        var body = new ErrorResponse.Body(ex.code(), ex.getMessage(), List.of(), ex.details());
        return ResponseEntity.status(ex.status()).body(new ErrorResponse(body, requestId()));
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    ResponseEntity<ErrorResponse> handleValidation(MethodArgumentNotValidException ex) {
        var fields = ex.getBindingResult().getFieldErrors().stream()
                .map(f -> new ErrorResponse.FieldError(f.getField(), f.getDefaultMessage()))
                .toList();
        var body = new ErrorResponse.Body("VALIDATION_FAILED", "Please check the highlighted fields", fields, null);
        return ResponseEntity.badRequest().body(new ErrorResponse(body, requestId()));
    }

    @ExceptionHandler(ConstraintViolationException.class)
    ResponseEntity<ErrorResponse> handleConstraint(ConstraintViolationException ex) {
        var fields = ex.getConstraintViolations().stream()
                .map(v -> new ErrorResponse.FieldError(v.getPropertyPath().toString(), v.getMessage()))
                .toList();
        var body = new ErrorResponse.Body("VALIDATION_FAILED", "Invalid request", fields, null);
        return ResponseEntity.badRequest().body(new ErrorResponse(body, requestId()));
    }

    @ExceptionHandler({HttpMessageNotReadableException.class, MethodArgumentTypeMismatchException.class,
            MissingServletRequestParameterException.class, MissingRequestHeaderException.class})
    ResponseEntity<ErrorResponse> handleBadInput(Exception ex) {
        String message = ex instanceof MissingRequestHeaderException h
                ? "Missing required header " + h.getHeaderName()
                : ex instanceof MissingServletRequestParameterException p
                        ? "Missing required parameter " + p.getParameterName()
                        : "The request could not be read";
        return error(HttpStatus.BAD_REQUEST, "VALIDATION_FAILED", message);
    }

    @ExceptionHandler(HttpRequestMethodNotSupportedException.class)
    ResponseEntity<ErrorResponse> handleMethod(HttpRequestMethodNotSupportedException ex) {
        return error(HttpStatus.METHOD_NOT_ALLOWED, "METHOD_NOT_ALLOWED", "Method not allowed");
    }

    @ExceptionHandler(HttpMediaTypeNotSupportedException.class)
    ResponseEntity<ErrorResponse> handleMediaType(HttpMediaTypeNotSupportedException ex) {
        return error(HttpStatus.UNSUPPORTED_MEDIA_TYPE, "UNSUPPORTED_MEDIA_TYPE", "Send JSON");
    }

    @ExceptionHandler(NoResourceFoundException.class)
    ResponseEntity<ErrorResponse> handleNoResource(NoResourceFoundException ex) {
        return error(HttpStatus.NOT_FOUND, "NOT_FOUND", "Not found");
    }

    @ExceptionHandler(AccessDeniedException.class)
    ResponseEntity<ErrorResponse> handleAccessDenied(AccessDeniedException ex) {
        var auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth == null || auth instanceof AnonymousAuthenticationToken) {
            return error(HttpStatus.UNAUTHORIZED, "UNAUTHENTICATED", "Please sign in");
        }
        return error(HttpStatus.FORBIDDEN, "FORBIDDEN", "You do not have access to this resource");
    }

    /**
     * Optimistic lock failure: two requests changed the same row at once and we lost.
     * Telling the client to retry is safe because nothing was written.
     */
    @ExceptionHandler({ObjectOptimisticLockingFailureException.class, PessimisticLockingFailureException.class})
    ResponseEntity<ErrorResponse> handleLocking(Exception ex) {
        log.info("Concurrent update rejected: {}", ex.getMessage());
        return error(HttpStatus.CONFLICT, "CONCURRENT_UPDATE", "This was changed at the same time by another request. Please try again.");
    }

    /** A database constraint caught something the service layer did not. */
    @ExceptionHandler(DataIntegrityViolationException.class)
    ResponseEntity<ErrorResponse> handleIntegrity(DataIntegrityViolationException ex) {
        log.warn("Constraint violation: {}", ex.getMostSpecificCause().getMessage());
        return error(HttpStatus.CONFLICT, "CONFLICT", "This conflicts with existing data");
    }

    /**
     * The client hung up, e.g. the browser left the seat map and closed its live SSE stream
     * ("connection was aborted" / "broken pipe"). Normal behaviour, nothing to send back.
     */
    @ExceptionHandler({AsyncRequestNotUsableException.class, java.io.IOException.class})
    void handleClientGone(Exception ex) {
        log.debug("Client disconnected: {}", ex.getMessage());
    }

    @ExceptionHandler(Exception.class)
    ResponseEntity<ErrorResponse> handleUnexpected(Exception ex) {
        log.error("Unhandled error", ex);
        return error(HttpStatus.INTERNAL_SERVER_ERROR, "INTERNAL_ERROR", "Something went wrong on our side. Please try again.");
    }

    private ResponseEntity<ErrorResponse> error(HttpStatus status, String code, String message) {
        return ResponseEntity.status(status).body(ErrorResponse.of(code, message, requestId()));
    }

    static String requestId() {
        return MDC.get(RequestIdFilter.MDC_KEY);
    }
}
