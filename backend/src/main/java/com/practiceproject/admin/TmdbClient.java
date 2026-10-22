package com.practiceproject.admin;

import com.fasterxml.jackson.databind.JsonNode;
import com.practiceproject.catalog.Movie;
import com.practiceproject.common.ApiException;
import com.practiceproject.config.AppProperties;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.util.UriComponentsBuilder;

/**
 * The Movie Database (TMDB) v3 API, used only by admins to import metadata.
 * Docs: https://developer.themoviedb.org/reference/intro/getting-started
 * The key stays on the server; the browser never sees it.
 */
@Component
public class TmdbClient {

    private static final String API = "https://api.themoviedb.org/3";
    private static final String IMAGES = "https://image.tmdb.org/t/p/";

    public record SearchResult(Long tmdbId, String title, LocalDate releaseDate, String posterUrl, String overview) {}

    public record TmdbMovie(Long tmdbId, String title, String tagline, String overview, Integer runtime, LocalDate releaseDate,
                            List<String> languages, List<String> genres, String director, List<Movie.CastMember> cast,
                            String trailerUrl, String posterUrl, String backdropUrl) {}

    private final AppProperties.Tmdb config;
    private final RestClient http;

    public TmdbClient(AppProperties props, RestClient.Builder builder) {
        this.config = props.tmdb();
        this.http = builder.build();
    }

    public List<SearchResult> search(String query) {
        JsonNode body = get(UriComponentsBuilder.fromUriString(API + "/search/movie")
                .queryParam("query", query).queryParam("include_adult", false));
        List<SearchResult> results = new ArrayList<>();
        for (JsonNode n : body.path("results")) {
            results.add(new SearchResult(n.path("id").asLong(), n.path("title").asText(), date(n.path("release_date").asText(null)),
                    image("w342", n.path("poster_path").asText(null)), n.path("overview").asText("")));
            if (results.size() >= 12) {
                break;
            }
        }
        return results;
    }

    public TmdbMovie details(long id) {
        JsonNode n = get(UriComponentsBuilder.fromUriString(API + "/movie/" + id).queryParam("append_to_response", "credits,videos"));
        List<String> genres = new ArrayList<>();
        n.path("genres").forEach(g -> genres.add(g.path("name").asText()));
        List<String> languages = new ArrayList<>();
        n.path("spoken_languages").forEach(l -> languages.add(l.path("english_name").asText(l.path("name").asText())));
        String director = null;
        for (JsonNode c : n.path("credits").path("crew")) {
            if ("Director".equals(c.path("job").asText())) {
                director = c.path("name").asText();
                break;
            }
        }
        List<Movie.CastMember> cast = new ArrayList<>();
        for (JsonNode c : n.path("credits").path("cast")) {
            cast.add(new Movie.CastMember(c.path("name").asText(), c.path("character").asText(null)));
            if (cast.size() >= 12) {
                break;
            }
        }
        String trailer = null;
        for (JsonNode v : n.path("videos").path("results")) {
            if ("YouTube".equals(v.path("site").asText()) && "Trailer".equals(v.path("type").asText())) {
                trailer = "https://www.youtube.com/watch?v=" + v.path("key").asText();
                break;
            }
        }
        return new TmdbMovie(n.path("id").asLong(), n.path("title").asText(), n.path("tagline").asText(null),
                n.path("overview").asText(""), n.path("runtime").isInt() ? n.path("runtime").asInt() : null,
                date(n.path("release_date").asText(null)), languages, genres, director, cast, trailer,
                image("w780", n.path("poster_path").asText(null)), image("w1280", n.path("backdrop_path").asText(null)));
    }

    private JsonNode get(UriComponentsBuilder uri) {
        if (!config.enabled()) {
            throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "TMDB_NOT_CONFIGURED",
                    "TMDB import is not configured. Set TMDB_API_KEY on the server to enable it.");
        }
        // TMDB accepts either a v3 api_key query parameter or a v4 read-access token (long JWT) as a Bearer header.
        boolean bearer = config.apiKey().length() > 60;
        String url = (bearer ? uri : uri.queryParam("api_key", config.apiKey())).queryParam("language", "en-GB").build().toUriString();
        try {
            var request = http.get().uri(url);
            if (bearer) {
                request = request.header("Authorization", "Bearer " + config.apiKey());
            }
            JsonNode body = request.retrieve().body(JsonNode.class);
            if (body == null) {
                throw new IllegalStateException("empty response");
            }
            return body;
        } catch (Exception e) {
            throw new ApiException(HttpStatus.BAD_GATEWAY, "TMDB_UNAVAILABLE", "TMDB could not be reached: "
                    + e.getMessage().toLowerCase(Locale.ROOT).replaceAll("api_key=[^&\\s]+", "api_key=***"));
        }
    }

    private static String image(String size, String path) {
        return path == null || path.isBlank() || "null".equals(path) ? null : IMAGES + size + path;
    }

    private static LocalDate date(String s) {
        try {
            return s == null || s.isBlank() ? null : LocalDate.parse(s);
        } catch (Exception e) {
            return null;
        }
    }
}
