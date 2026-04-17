<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class EmployeeSalaryProfile extends Model
{
    protected $fillable = [
        'user_id',
        'monthly_salary',
        'payment_day',
        'is_active',
        'notes',
    ];

    protected $casts = [
        'monthly_salary' => 'decimal:2',
        'payment_day' => 'integer',
        'is_active' => 'boolean',
    ];

    public function user()
    {
        return $this->belongsTo(User::class);
    }

    public function payrollTransactions()
    {
        return $this->hasMany(EmployeePayrollTransaction::class, 'salary_profile_id');
    }
}
