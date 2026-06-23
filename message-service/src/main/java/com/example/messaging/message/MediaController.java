package com.example.messaging.message;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.Resource;
import org.springframework.core.io.UrlResource;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.util.StringUtils;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import java.nio.file.Files;
import java.nio.file.Path;

@RestController
@RequestMapping("/api/media")
public class MediaController {
    private final Path mediaDir;

    public MediaController(@Value("${app.media-dir:uploads}") String mediaDir) {
        this.mediaDir = Path.of(mediaDir).toAbsolutePath().normalize();
    }

    @GetMapping("/{name:.+}")
    public ResponseEntity<Resource> get(@PathVariable("name") String name) throws Exception {
        Path target = mediaDir.resolve(StringUtils.cleanPath(name)).normalize();
        if (!target.startsWith(mediaDir)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid file name");
        }
        Resource resource = new UrlResource(target.toUri());
        if (!resource.exists() || !resource.isReadable()) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Media not found");
        }
        String contentType = Files.probeContentType(target);
        return ResponseEntity.ok()
                .contentType(contentType == null ? MediaType.APPLICATION_OCTET_STREAM : MediaType.parseMediaType(contentType))
                .body(resource);
    }
}
