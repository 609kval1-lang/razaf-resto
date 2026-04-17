<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class PublicMediaRouteTest extends TestCase
{
    public function test_public_media_route_serves_a_file_from_the_public_disk(): void
    {
        Storage::disk('public')->put('menu-images/test-image.txt', 'image-demo');

        $response = $this->get('/api/media/public/menu-images/test-image.txt');

        $response->assertOk();
        $this->assertStringContainsString(
            'max-age=86400',
            (string) $response->headers->get('cache-control', '')
        );
    }

    public function test_public_media_route_returns_not_found_for_a_missing_file(): void
    {
        $this->get('/api/media/public/menu-images/missing-file.txt')
            ->assertNotFound();
    }
}
