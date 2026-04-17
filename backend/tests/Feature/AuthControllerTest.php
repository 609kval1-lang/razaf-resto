<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\PersonalAccessToken;
use Tests\TestCase;

class AuthControllerTest extends TestCase
{
    use RefreshDatabase;

    public function test_public_register_route_is_not_available(): void
    {
        $response = $this->postJson('/api/register', [
            'name' => 'Public User',
            'email' => 'public@example.com',
            'password' => 'Secret123',
        ]);

        $response->assertNotFound();

        $this->assertDatabaseMissing('users', [
            'email' => 'public@example.com',
        ]);
    }

    public function test_logout_revokes_the_current_token(): void
    {
        $user = User::factory()->create([
            'role' => 'admin',
            'has_system_access' => true,
        ]);
        $token = $user->createToken('test-token')->plainTextToken;

        $this->withHeader('Authorization', 'Bearer ' . $token)
            ->postJson('/api/logout')
            ->assertOk()
            ->assertJsonPath('message', 'Déconnexion effectuée.');

        $this->assertSame(0, PersonalAccessToken::query()->count());
    }
}
