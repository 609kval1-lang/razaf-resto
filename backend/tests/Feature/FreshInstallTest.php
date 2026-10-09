<?php

namespace Tests\Feature;

use App\Models\Menu;
use App\Models\RawMaterial;
use App\Models\User;
use Database\Seeders\RazafRestoSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Artisan;
use Tests\TestCase;

class FreshInstallTest extends TestCase
{
    use RefreshDatabase;

    public function test_demo_seeder_creates_an_active_admin_and_catalog(): void
    {
        Artisan::call('db:seed', ['--class' => RazafRestoSeeder::class]);

        $this->assertDatabaseHas('users', [
            'email' => 'admin@razaf.com',
            'role' => 'admin',
        ]);
        $this->assertGreaterThan(0, RawMaterial::query()->count());
        $this->assertGreaterThan(0, Menu::query()->count());
        $this->assertSame(1, User::query()->where('role', 'admin')->count());
    }
}
