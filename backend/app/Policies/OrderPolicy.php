<?php

namespace App\Policies;

use App\Models\Order;
use App\Models\User;

class OrderPolicy
{
    /**
     * Determine whether the user can view any models.
     */
    public function viewAny(User $user): bool
    {
        // Kitchen, Bar, Cashier, Admin, Server, Manager peuvent voir les commandes
        return in_array($user->role, ['admin', 'kitchen', 'barman', 'cashier', 'server', 'manager']);
    }

    /**
     * Determine whether the user can view the model.
     */
    public function view(User $user, Order $order): bool
    {
        // Admin voit tout
        // Kitchen voit seulement les commandes non servies
        // Cashier voit seulement les commandes prêtes et servies
        // Server et autre voient seulement leurs propres commandes
        if ($user->role === 'admin') {
            return true;
        }
        if ($user->role === 'kitchen' && in_array($order->status, ['pending', 'preparing', 'ready'])) {
            return true;
        }
        if ($user->role === 'barman') {
            return $order->items()->where('station', 'bar')->exists();
        }
        if ($user->role === 'cashier' && in_array($order->status, ['ready', 'served'])) {
            return true;
        }
        return $user->id === $order->user_id;
    }

    /**
     * Determine whether the user can create models.
     */
    public function create(User $user): bool
    {
        // Seulement server, employee et admin peuvent créer des commandes
        return in_array($user->role, ['admin', 'employee', 'server', 'manager']);
    }

    /**
     * Determine whether the user can update the model.
     */
    public function update(User $user, Order $order): bool
    {
        // Seulement admin ou créateur et status pending
        return $user->role === 'admin' || ($user->id === $order->user_id && $order->status === 'pending');
    }

    /**
     * Determine whether the user can change the status of the model.
     */
    public function changeStatus(User $user, Order $order): bool
    {
        // Kitchen, barman, cashier, admin et manager peuvent changer de status
        return in_array($user->role, ['admin', 'kitchen', 'barman', 'cashier', 'manager']);
    }

    /**
     * Determine whether the user can cancel the model.
     */
    public function cancel(User $user, Order $order): bool
    {
        // Admin peut toujours annuler
        // Créateur peut annuler si pending
        // Manager peut annuler si pas servi
        if ($user->role === 'admin') {
            return $order->status !== 'served' && $order->status !== 'cancelled';
        }
        if ($user->role === 'manager') {
            return $order->status !== 'served' && $order->status !== 'cancelled';
        }
        return $user->id === $order->user_id && $order->status === 'pending';
    }

    /**
     * Determine whether the user can delete the model.
     */
    public function delete(User $user, Order $order): bool
    {
        // Seulement admin peut supprimer
        return $user->role === 'admin';
    }
//    {
        // Kitchen et admin peuvent changer le statut
        // Les cuisiniers voient seulement les commandes
    //    return in_array($user->role, ['admin', 'kitchen']);
  //  }

    /**
     * Determine whether the user can cancel the model.
     */
 /*   public function cancel(User $user, Order $order): bool
    {
        // Seulement creator ou admin avant que préparation commence
        if ($user->role === 'admin') {
            return $order->status !== 'served' && $order->status !== 'cancelled';
        }

        return $user->id === $order->user_id && $order->status === 'pending';
    }

    /**
     * Determine whether the user can delete the model.
     */
/*    public function delete(User $user, Order $order): bool
    {
        // Seulement admin peut supprimer
        return $user->role === 'admin';
    }*/
}
