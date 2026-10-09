<?php

namespace App\Http\Controllers;

use App\Models\Customer;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class CustomerController extends Controller
{
    public function index()
    {
        return response()->json(
            Customer::orderByDesc('id')->get()
        );
    }

    public function create()
    {
        return response()->json(['message' => 'Formulaire de creation client']);
    }

    public function store(Request $request)
    {
        $validated = $request->validate([
            'name' => ['required', 'string', 'max:255'],
            'email' => ['nullable', 'email', 'max:255', 'unique:customers,email'],
            'phone' => ['nullable', 'string', 'max:30'],
        ]);

        $customer = Customer::create($validated);

        return response()->json([
            'message' => 'Client cree avec succes',
            'customer' => $customer,
        ], 201);
    }

    public function show(Customer $customer)
    {
        return response()->json($customer);
    }

    public function edit(Customer $customer)
    {
        return response()->json($customer);
    }

    public function update(Request $request, Customer $customer)
    {
        $validated = $request->validate([
            'name' => ['sometimes', 'required', 'string', 'max:255'],
            'email' => ['nullable', 'email', 'max:255', Rule::unique('customers', 'email')->ignore($customer->id)],
            'phone' => ['nullable', 'string', 'max:30'],
        ]);

        $customer->update($validated);

        return response()->json([
            'message' => 'Client modifie avec succes',
            'customer' => $customer,
        ]);
    }

    public function destroy(Customer $customer)
    {
        $customer->delete();

        return response()->json([
            'message' => 'Client supprime avec succes',
        ]);
    }
}
