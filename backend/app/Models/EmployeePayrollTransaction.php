<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class EmployeePayrollTransaction extends Model
{
    public const TYPE_ADVANCE = 'advance';
    public const TYPE_SALARY_PAYMENT = 'salary_payment';

    protected $fillable = [
        'user_id',
        'salary_profile_id',
        'transaction_type',
        'gross_amount',
        'advance_deduction_amount',
        'net_amount',
        'payment_method',
        'source_account',
        'payroll_month',
        'reference',
        'note',
        'paid_at',
        'cash_movement_id',
        'created_by_user_id',
        'metadata',
    ];

    protected $casts = [
        'gross_amount' => 'decimal:2',
        'advance_deduction_amount' => 'decimal:2',
        'net_amount' => 'decimal:2',
        'payroll_month' => 'date',
        'paid_at' => 'datetime',
        'metadata' => 'array',
    ];

    public function user()
    {
        return $this->belongsTo(User::class);
    }

    public function salaryProfile()
    {
        return $this->belongsTo(EmployeeSalaryProfile::class, 'salary_profile_id');
    }

    public function cashMovement()
    {
        return $this->belongsTo(CashMovement::class);
    }

    public function createdBy()
    {
        return $this->belongsTo(User::class, 'created_by_user_id');
    }

    public function advanceSettlements()
    {
        return $this->hasMany(EmployeeAdvanceSettlement::class, 'advance_transaction_id');
    }

    public function salarySettlements()
    {
        return $this->hasMany(EmployeeAdvanceSettlement::class, 'salary_transaction_id');
    }
}
