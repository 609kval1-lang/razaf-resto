<?php

namespace App\Providers;

use App\Models\Category;
use App\Models\Product;
use App\Models\Supplier;
use App\Policies\CategoryPolicy;
use App\Policies\ProductPolicy;
use App\Policies\SupplierPolicy;
use Illuminate\Foundation\Support\Providers\AuthServiceProvider as ServiceProvider;

class AuthServiceProvider extends ServiceProvider
{
    /** @var array<class-string, class-string> */
    protected $policies = [
        Product::class => ProductPolicy::class,
        Category::class => CategoryPolicy::class,
        Supplier::class => SupplierPolicy::class,
    ];

    public function boot(): void
    {
    }
}
