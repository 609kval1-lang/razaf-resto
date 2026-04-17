<?php

namespace App\Policies;

use App\Models\Category;
use App\Models\User;

class CategoryPolicy
{
    /**
     * Determine if the user can view any categories.
     */
    public function viewAny(User $user): bool
    {
        // Tous les utilisateurs authentifiés peuvent voir les catégories
        return true;
    }

    /**
     * Determine if the user can view the category.
     */
    public function view(User $user, Category $category): bool
    {
        // Tous les utilisateurs authentifiés peuvent voir une catégorie
        return true;
    }

    /**
     * Determine if the user can create categories.
     */
    public function create(User $user): bool
    {
        // Seul l'admin peut créer des catégories
        return $user->role === 'admin';
    }

    /**
     * Determine if the user can update the category.
     */
    public function update(User $user, Category $category): bool
    {
        // Seul l'admin peut modifier des catégories
        return $user->role === 'admin';
    }

    /**
     * Determine if the user can delete the category.
     */
    public function delete(User $user, Category $category): bool
    {
        // Seul l'admin peut supprimer des catégories
        return $user->role === 'admin';
    }

    /**
     * Determine if the user can restore the category.
     */
    public function restore(User $user, Category $category): bool
    {
        return $user->role === 'admin';
    }

    /**
     * Determine if the user can permanently delete the category.
     */
    public function forceDelete(User $user, Category $category): bool
    {
        return $user->role === 'admin';
    }
}
