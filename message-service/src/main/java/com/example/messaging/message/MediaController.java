package com.example.messaging.message;

import org.springframework.core.io.Resource;
import org.springframework.core.io.UrlResource;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import java.nio.file.Path;

@RestController
@RequestMapping("/api/media")
public class MediaController {
    @GetMapping("/{name}")
    public ResponseEntity<Resource> get(@PathVariable("name") String name) throws Exception {
        Resource resource = new UrlResource(Path.of("uploads", name).toUri());
        return ResponseEntity.ok(resource);
    }
}
