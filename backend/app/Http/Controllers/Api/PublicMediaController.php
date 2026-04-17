<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\HttpFoundation\BinaryFileResponse;

class PublicMediaController extends Controller
{
    public function showPublicStorageFile(string $path): BinaryFileResponse
    {
        $normalizedPath = ltrim(str_replace('\\', '/', $path), '/');

        if ($normalizedPath === '' || str_contains($normalizedPath, '..')) {
            abort(404);
        }

        $disk = Storage::disk('public');
        if (!$disk->exists($normalizedPath)) {
            abort(404);
        }

        return response()->file($disk->path($normalizedPath), [
            'Cache-Control' => 'public, max-age=86400',
        ]);
    }
}
