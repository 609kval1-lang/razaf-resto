<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use App\Models\User;
use Illuminate\Support\Facades\Password;

class AuthController extends Controller
{
    // Inscription
    public function register(Request $request)
    {
        $request->validate([
            'name' => 'required|string',
            'email' => 'required|string|email|unique:users,email',
            'password' => 'required|string|min:6|regex:/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/',
        ], [
            'password.min' => 'Le mot de passe doit contenir au moins 06 caractères.',
            'password.regex' => 'Le mot de passe doit contenir au moins une majuscule, une minuscule et un chiffre.'
        ]);

        $user = User::create([
            'name' => $request->name,
            'email' => $request->email,
            'password' => Hash::make($request->password),
            'role' => 'employee',
            'has_system_access' => false,
            'employment_status' => 'active',
        ]);

        return response()->json([
            'message' => 'Compte créé. Un administrateur doit activer l\'accès au système.',
            'user' => $user,
            'token' => null,
        ], 201);
    }

    public function updateEmail(Request $request)
{
    $request->validate([
        'email' => 'required|string|email|unique:users,email',
    ]);

    $user = $request->user(); // récupère l’utilisateur connecté
    $user->email = $request->email;
    $user->save();

    return response()->json([
        'message' => 'Email mis à jour avec succès.',
        'user' => $user
    ]);
}


 public function login(Request $request)
    {
        $request->validate([
            'email' => 'required|string',
            'password' => 'required|string',
        ]);

        $user = User::where('email', $request->email)->first();

         if (!$user || empty($user->password) || !Hash::check($request->password, $user->password)) {
        return response()->json([
            'error' => __('auth.failed') // récupère la traduction française
        ], 401);
    }

        if (!$user->has_system_access) {
            return response()->json([
                'error' => 'Ce profil employe ne dispose pas d\'un acces au systeme.',
            ], 403);
        }

        $token = $user->createToken('auth_token')->plainTextToken;

        return response()->json([
            'token' => $token,
            'user' => $user
        ]);
    }

    public function logout(Request $request)
    {
        $user = $request->user();
        $token = $user?->currentAccessToken();

        if ($token && method_exists($token, 'delete')) {
            $token->delete();
        } elseif ($user) {
            $user->tokens()->delete();
        }

        return response()->json([
            'message' => 'Déconnexion effectuée.',
        ]);
    }


 public function forgot_password (Request $request) {
    $request->validate(['email' => 'required|email']);

    $status = Password::sendResetLink(
        $request->only('email')
    );

    return $status === Password::RESET_LINK_SENT
        ? response()->json(['message' => __($status)])
        : response()->json(['error' => __($status)], 400);
}

public function reset_password (Request $request) {
    $request->validate([
        'token' => 'required',
        'email' => 'required|email',
        'password' => 'required|string|min:6|confirmed|regex:/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/',
    ], [
        'password.min' => 'Le mot de passe doit contenir au moins 06 caractères.',
        'password.regex' => 'Le mot de passe doit contenir au moins une majuscule, une minuscule et un chiffre.'
    ]);

    $status = Password::reset(
        $request->only('email', 'password', 'password_confirmation', 'token'),
        function ($user, $password) {
            $user->forceFill([
                'password' => Hash::make($password)
            ])->save();
        }
    );

    return $status === Password::PASSWORD_RESET
        ? response()->json(['message' => __($status)])
        : response()->json(['error' => __($status)], 400);
}

public function changePassword(Request $request)
{
    $request->validate([
        'current_password' => 'required|string',
        'new_password' => 'required|string|min:6|confirmed|regex:/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/',
    ], [
        'new_password.min' => 'Le mot de passe doit contenir au moins 06 caractères.',
        'new_password.regex' => 'Le mot de passe doit contenir au moins une majuscule, une minuscule et un chiffre.',
        'new_password.confirmed' => 'La confirmation du nouveau mot de passe ne correspond pas.',
    ]);

    $user = $request->user();

    if (!$user || !Hash::check($request->current_password, $user->password)) {
        return response()->json([
            'message' => 'Mot de passe actuel incorrect.',
        ], 422);
    }

    if (Hash::check($request->new_password, $user->password)) {
        return response()->json([
            'message' => 'Le nouveau mot de passe doit être différent de l\'ancien.',
        ], 422);
    }

    $user->password = Hash::make($request->new_password);
    $user->save();

    return response()->json([
        'message' => 'Mot de passe modifié avec succès.',
    ]);
}
}
