<?php

namespace App\Http\Controllers;

use App\Models\User;
use Illuminate\Http\Request;

class UserController extends Controller
{
    /**
     * Get all users with role management
     */
    public function index()
    {
        $users = User::select('id', 'name', 'email', 'role', 'created_at')
            ->orderBy('created_at', 'desc')
            ->get();

        return response()->json($users);
    }

    /**
     * Get a single user
     */
    public function show(User $user)
    {
        return response()->json($user);
    }

    /**
     * Update user role
     */
    public function updateRole(Request $request, User $user)
    {
        $validated = $request->validate([
            'role' => ['required', 'string', 'in:admin,kitchen,barman,cashier,server,employee,manager'],
        ]);

        $user->update(['role' => $validated['role']]);

        return response()->json([
            'message' => 'Rôle de l\'utilisateur mis à jour',
            'user' => $user,
        ]);
    }

    /**
     * Delete a user
     */
    public function destroy(User $user)
    {
        $user->delete();

        return response()->json([
            'message' => 'Utilisateur supprimé',
        ]);
    }
}
